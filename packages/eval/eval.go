package eval

import (
	"bytes"
	"connectrpc.com/connect"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"github.com/rs/xid"
	"github.com/stillmatic/gollum/packages/llm"
	pb "github.com/tincans-ai/evalite/gen/eval/v1"
	"github.com/tincans-ai/evalite/gen/eval/v1/evalv1connect"
	"github.com/tincans-ai/evalite/packages/llmutils"
	"github.com/tincans-ai/evalite/packages/logutil"
	"github.com/tincans-ai/evalite/packages/providerstore"
	"gorm.io/gorm"
	"sync"
)

var (
	//go:embed prompts/generate_prompt.txt
	generatePromptPrompt string
	//go:embed prompts/summarize_prompt.txt
	summarizePromptPrompt string
)

type Service struct {
	db                      *gorm.DB
	models                  *llm.ModelConfigStore
	providers               *providerstore.ProviderStore
	defaultSmallModelConfig string
	defaultLargeModelConfig string
}

func NewService(db *gorm.DB) *Service {
	models := llm.NewModelConfigStore()
	providers := providerstore.NewProviderStore()

	return &Service{db: db, models: models, providers: providers,
		// todo: check if openai provider is available
		defaultSmallModelConfig: "gpt-4-mini",
		defaultLargeModelConfig: "gpt-4o",
	}
}

func (s *Service) Evaluate(ctx context.Context, req *connect.Request[pb.EvaluationRequest]) (*connect.Response[pb.EvaluationResponse], error) {
	logger := logutil.LoggerFromContext(ctx)
	logger.Debug("evaluating req", "req", req.Msg)

	workspace, err := s.getWorkspace(req.Msg.WorkspaceId)
	if err != nil {
		return nil, err
	}

	testCase, err := s.getOrCreateTestCase(req.Msg.TestCase, workspace.ID)
	if err != nil {
		return nil, err
	}

	prompt := workspace.PromptByVersion(req.Msg.VersionNumber)
	systemPrompt := workspace.SystemPromptByVersion(req.Msg.SystemPromptVersionNumber)

	workspaceConfigs := s.getActiveWorkspaceConfigs(workspace, testCase.ID, int32(req.Msg.VersionNumber))

	results, err := s.processTestCaseWithConfigs(ctx, testCase, prompt, systemPrompt, workspaceConfigs)
	if err != nil {
		return nil, err
	}

	res := connect.NewResponse(&pb.EvaluationResponse{
		Result: results,
	})

	res.Header().Set("Eval-Version", "v1")
	return res, nil
}
func (s *Service) SyntheticGeneration(ctx context.Context, req *connect.Request[pb.SyntheticGenerationRequest]) (*connect.Response[pb.EvaluationResponse], error) {
	logger := logutil.LoggerFromContext(ctx)
	logger.Debug("synthetic generation request", "req", req.Msg)

	workspace, err := s.getWorkspace(req.Msg.WorkspaceId)
	if err != nil {
		return nil, err
	}

	testCases, err := s.getTestCases(workspace.ID)
	if err != nil {
		return nil, err
	}

	activeConfig := s.getActiveWorkspaceConfig(workspace)
	if activeConfig == nil {
		return nil, fmt.Errorf("no active workspace config found")
	}

	prompt := workspace.PromptByVersion(req.Msg.VersionNumber)
	systemPrompt := workspace.SystemPromptByVersion(req.Msg.SystemPromptVersionNumber)

	var results []*pb.TestResult
	for _, testCase := range testCases {
		logger.Debug("processing test case", "test_case_id", testCase.ID)
		caseResults, err := s.processTestCaseWithConfigs(ctx, testCase, prompt, systemPrompt, []WorkspaceConfig{*activeConfig})
		if err != nil {
			logger.Error("failed to process test case", "err", err, "test_case_id", testCase.ID)
			continue
		}
		logger.Debug("processed test case", "test_case_id", testCase.ID, "results", caseResults)
		results = append(results, caseResults...)
	}

	res := connect.NewResponse(&pb.EvaluationResponse{
		Result: results,
	})

	res.Header().Set("Synthetic-Gen-Version", "v1")
	return res, nil
}

func (s *Service) processTestCaseWithConfigs(ctx context.Context, testCase TestCase, prompt *Prompt, systemPrompt *SystemPrompt, configs []WorkspaceConfig) ([]*pb.TestResult, error) {
	vars := s.prepareVariables(testCase)
	promptStr := llmutils.ReplacePromptVariables(prompt.Content, vars)

	baseMessages := s.prepareBaseMessages(systemPrompt, promptStr, len(configs) > 5)

	var results []*pb.TestResult
	var wg sync.WaitGroup
	resultsChan := make(chan *pb.TestResult, len(configs))
	errorsChan := make(chan error, len(configs))

	for _, config := range configs {
		wg.Add(1)
		go func(config WorkspaceConfig) {
			defer wg.Done()

			modelConfig, ok := s.models.GetConfig(config.ModelConfigName)
			if !ok {
				errorsChan <- fmt.Errorf("model config %s not found", config.ModelConfigName)
				return
			}

			result, err := s.processSingleConfig(ctx, testCase, prompt, baseMessages, config, modelConfig)
			if err != nil {
				errorsChan <- err
				return
			}

			resultsChan <- result
		}(config)
	}

	go func() {
		wg.Wait()
		close(resultsChan)
		close(errorsChan)
	}()

	for result := range resultsChan {
		results = append(results, result)
	}

	for err := range errorsChan {
		if err != nil {
			return nil, err
		}
	}

	return results, nil
}

func (s *Service) processSingleConfig(ctx context.Context, testCase TestCase, prompt *Prompt, baseMessages []llm.InferMessage, config WorkspaceConfig, modelConfig llm.ModelConfig) (*pb.TestResult, error) {
	logger := logutil.LoggerFromContext(ctx)
	// check if this has been evaluated already
	if testCase.HasBeenEvaluated {
		var tr TestResult
		if err := s.db.First(&tr, "test_case_id = ? AND workspace_config_id = ? AND prompt_version_number = ?", testCase.ID, config.ID, prompt.VersionNumber).Error; err == nil {
			logger.Debug("test case already evaluated", "test_case_id", testCase.ID, "config_name", config.ModelConfigName)
			return &pb.TestResult{
				Id:              tr.ID,
				Response:        tr.Response,
				TestCaseId:      testCase.ID,
				ModelConfigName: config.ModelConfigName,
				MessageOptions: &pb.MessageOptions{
					MaxTokens:   int32(config.MessageOptions.MaxTokens),
					Temperature: config.MessageOptions.Temperature,
				},
				PromptVersionNumber: prompt.VersionNumber,
				WorkspaceConfigId:   config.ID,
			}, nil
		}
	}

	llmReq := llm.InferRequest{
		ModelConfig: modelConfig,
		Messages:    baseMessages,
		MessageOptions: llm.MessageOptions{
			MaxTokens:   int(config.MessageOptions.MaxTokens),
			Temperature: config.MessageOptions.Temperature,
		},
	}

	llmResp, err := s.InferSync(ctx, llmReq)
	if err != nil {
		return nil, fmt.Errorf("failed to infer: %w", err)
	}

	tr := TestResult{
		ID:                  xid.New().String(),
		TestCaseID:          testCase.ID,
		Response:            llmResp,
		PromptVersionNumber: prompt.VersionNumber,
		ModelConfigName:     config.ModelConfigName,
		MessageOptions:      config.MessageOptions,
		WorkspaceConfigID:   config.ID,
	}
	if err := s.db.Create(&tr).Error; err != nil {
		return nil, fmt.Errorf("failed to save test result: %w", err)
	}

	testCase.HasBeenEvaluated = true

	updateFields := map[string]interface{}{
		"HasBeenEvaluated": true,
	}
	if err := s.db.Model(&TestCase{}).Where("id = ?", testCase.ID).Updates(updateFields).Error; err != nil {
		return nil, fmt.Errorf("failed to update test case evaluation status: %w", err)
	}

	return &pb.TestResult{
		Id:              tr.ID,
		Response:        llmResp,
		TestCaseId:      testCase.ID,
		ModelConfigName: config.ModelConfigName,
		MessageOptions: &pb.MessageOptions{
			MaxTokens:   int32(config.MessageOptions.MaxTokens),
			Temperature: config.MessageOptions.Temperature,
		},
		PromptVersionNumber: prompt.VersionNumber,
		WorkspaceConfigId:   config.ID,
	}, nil
}

func (s *Service) getWorkspace(id string) (*Workspace, error) {
	var workspace Workspace
	if err := s.db.Preload("Prompts").Preload("WorkspaceConfigs").Preload("SystemPrompts").First(&workspace, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("workspace not found: %w", err)
	}
	return &workspace, nil
}

func (s *Service) getOrCreateTestCase(testCase *pb.TestCase, workspaceID string) (TestCase, error) {
	var newTestCase TestCase
	if err := s.db.First(&newTestCase, "id = ?", testCase.Id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			newTestCase = TestCase{
				ID:             xid.New().String(),
				VariableValues: s.convertVariableValues(testCase.VariableValues),
				WorkspaceID:    workspaceID,
			}
			if err := s.db.Create(&newTestCase).Error; err != nil {
				return TestCase{}, fmt.Errorf("failed to create test case: %w", err)
			}
		} else {
			return TestCase{}, fmt.Errorf("failed to fetch test case: %w", err)
		}
	}

	// Update test case if needed
	if s.shouldUpdateTestCase(&newTestCase, testCase) {
		newTestCase.VariableValues = s.convertVariableValues(testCase.VariableValues)
		newTestCase.HasBeenEvaluated = true
		if err := s.db.Save(&newTestCase).Error; err != nil {
			return TestCase{}, fmt.Errorf("failed to update test case: %w", err)
		}
	}

	return newTestCase, nil
}

func (s *Service) getTestCases(workspaceID string) ([]TestCase, error) {
	var testCases []TestCase
	if err := s.db.Where("workspace_id = ?", workspaceID).Find(&testCases).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch test cases: %w", err)
	}
	return testCases, nil
}

func (s *Service) getActiveWorkspaceConfigs(workspace *Workspace, testCaseID string, versionNumber int32) []WorkspaceConfig {
	var activeConfigs []WorkspaceConfig
	for _, wc := range workspace.WorkspaceConfigs {
		if wc.Active {
			var tr TestResult
			if err := s.db.First(&tr, "workspace_config_id = ? AND test_case_id = ? AND prompt_version_number = ?", wc.ID, testCaseID, versionNumber).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					activeConfigs = append(activeConfigs, wc)
				}
			}
		}
	}
	return activeConfigs
}

func (s *Service) getActiveWorkspaceConfig(workspace *Workspace) *WorkspaceConfig {
	for _, wc := range workspace.WorkspaceConfigs {
		if wc.Active {
			return &wc
		}
	}
	return nil
}

func (s *Service) prepareVariables(testCase TestCase) map[string]string {
	vars := make(map[string]string)
	for k, v := range testCase.VariableValues {
		if v.TextValue != nil {
			vars[k] = *v.TextValue
		}
		// TODO: Handle image values if needed
	}
	return vars
}

func (s *Service) prepareBaseMessages(systemPrompt *SystemPrompt, promptStr string, shouldCache bool) []llm.InferMessage {
	messages := make([]llm.InferMessage, 0)
	if systemPrompt != nil {
		messages = append(messages, llm.InferMessage{Content: systemPrompt.Content, Role: "system", ShouldCache: shouldCache})
	}
	messages = append(messages, llm.InferMessage{Content: promptStr, Role: "user", ShouldCache: shouldCache})
	return messages
}

// Additional helper functions

func (s *Service) convertVariableValues(pbValues map[string]*pb.VariableValue) map[string]VariableValue {
	varValues := make(map[string]VariableValue)
	for k, v := range pbValues {
		switch v.Value.(type) {
		case *pb.VariableValue_TextValue:
			varValues[k] = VariableValue{
				TextValue: &v.Value.(*pb.VariableValue_TextValue).TextValue,
			}
		case *pb.VariableValue_ImageValue:
			varValues[k] = VariableValue{
				ImageValue: v.GetImageValue(),
			}
		}
	}
	return varValues
}

func (s *Service) shouldUpdateTestCase(existingCase *TestCase, newCase *pb.TestCase) bool {
	if !existingCase.HasBeenEvaluated {
		return true
	}
	for k, v := range newCase.VariableValues {
		switch v.Value.(type) {
		case *pb.VariableValue_TextValue:
			if existingValue, ok := existingCase.VariableValues[k]; ok {
				if existingValue.TextValue == nil || *existingValue.TextValue != v.GetTextValue() {
					return true
				}
			} else {
				return true
			}
		case *pb.VariableValue_ImageValue:
			if existingValue, ok := existingCase.VariableValues[k]; ok {
				if !bytes.Equal(existingValue.ImageValue, v.GetImageValue()) {
					return true
				}
			} else {
				return true
			}
		}
	}
	return false
}

func (s *Service) Infer(ctx context.Context, req llm.InferRequest) (<-chan llm.StreamDelta, error) {
	provider := s.providers.GetProvider(req.ModelConfig.ProviderType)
	if provider == nil {
		return nil, fmt.Errorf("provider %s not found", req.ModelConfig.ProviderType)
	}
	return provider.GenerateResponseAsync(ctx, req)
}

func (s *Service) InferSync(ctx context.Context, req llm.InferRequest) (string, error) {
	provider := s.providers.GetProvider(req.ModelConfig.ProviderType)
	if provider == nil {
		return "", fmt.Errorf("provider %s not found", req.ModelConfig.ProviderType)
	}
	return provider.GenerateResponse(ctx, req)
}

var _ evalv1connect.EvaluationServiceHandler = (*Service)(nil)
