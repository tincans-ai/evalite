package eval

import (
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
	"golang.org/x/sync/semaphore"
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

	// Get the workspace and test case
	var workspace Workspace
	if err := s.db.Preload("Prompts").Preload("WorkspaceConfigs").Preload("SystemPrompts").First(&workspace, "id = ?", req.Msg.WorkspaceId).Error; err != nil {
		return nil, fmt.Errorf("workspace not found: %w", err)
	}

	testCaseID := req.Msg.TestCase.Id
	var newTestCase TestCase
	if err := s.db.First(&newTestCase, "id = ?", testCaseID).Error; err != nil {
		// if the test case is not found, create it
		if errors.Is(err, gorm.ErrRecordNotFound) {
			varValues := make(map[string]VariableValue)
			for k, v := range req.Msg.TestCase.VariableValues {
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
			testCaseID = xid.New().String()
			newTestCase = TestCase{
				ID:             testCaseID,
				VariableValues: varValues,
				WorkspaceID:    workspace.ID,
			}
			if err := s.db.Create(&newTestCase).Error; err != nil {
				return nil, fmt.Errorf("failed to create test case: %w", err)
			}
		}
	}
	// if the test case is updated in the request vs db, save
	anyDifferent := false
	for k, v := range req.Msg.TestCase.VariableValues {
		switch v.Value.(type) {
		case *pb.VariableValue_TextValue:
			if *newTestCase.VariableValues[k].TextValue != v.GetTextValue() {
				newTestCase.VariableValues[k] = VariableValue{
					TextValue: &v.Value.(*pb.VariableValue_TextValue).TextValue,
				}
				anyDifferent = true
			}
		case *pb.VariableValue_ImageValue:
			if string(newTestCase.VariableValues[k].ImageValue) != string(v.GetImageValue()) {
				newTestCase.VariableValues[k] = VariableValue{
					ImageValue: v.GetImageValue(),
				}
				anyDifferent = true
			}
		}
	}
	if !newTestCase.HasBeenEvaluated {
		newTestCase.HasBeenEvaluated = true
		anyDifferent = true
	}
	if anyDifferent {
		if err := s.db.Save(&newTestCase).Error; err != nil {
			return nil, fmt.Errorf("failed to save test case: %w", err)
		}
	}

	// generate prompt
	prompt := workspace.PromptByVersion(req.Msg.VersionNumber)
	vars := make(map[string]string)
	for k, v := range newTestCase.VariableValues {
		// TODO:support images
		if v.TextValue != nil {
			vars[k] = *v.TextValue
		}
	}
	promptStr := llmutils.ReplacePromptVariables(prompt.Content, vars)

	// find active workspace configs
	var workspaceConfigs []WorkspaceConfig
	for _, wc := range workspace.WorkspaceConfigs {
		if wc.Active {
			// check if we've run this test already - keyed on model config ID and test case ID and prompt version number
			var tr TestResult
			if err := s.db.First(&tr, "workspace_config_id = ? AND test_case_id = ? AND prompt_version_number = ?", wc.ID, testCaseID, req.Msg.VersionNumber).Error; err == nil {
				logger.Debug("found existing test result", "tr", tr)
				continue
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("failed to find test result: %w", err)
			}

			workspaceConfigs = append(workspaceConfigs, wc)
		}
	}

	systemPrompt := workspace.SystemPromptByVersion(req.Msg.SystemPromptVersionNumber)

	// create llm reqs
	// TODO: for a given model, cache if there are more than 5 requests to that specific model
	//shouldCache := len(workspaceConfigs) > 5
	shouldCache := false
	llmReqs := make([]llm.InferRequest, len(workspaceConfigs))
	for i, wc := range workspaceConfigs {
		modelConfig, ok := s.models.GetConfig(wc.ModelConfigName)
		if !ok {
			return nil, fmt.Errorf("model config %s not found", wc.ModelConfigName)
		}
		messages := make([]llm.InferMessage, 0)
		if systemPrompt != nil {
			messages = append(messages, llm.InferMessage{Content: systemPrompt.Content, Role: "system", ShouldCache: shouldCache})
		}
		messages = append(messages, llm.InferMessage{Content: promptStr, Role: "user", ShouldCache: shouldCache})
		llmReqs[i] = llm.InferRequest{
			ModelConfig: modelConfig,
			Messages:    messages,
			MessageOptions: llm.MessageOptions{
				MaxTokens:   int(wc.MessageOptions.MaxTokens),
				Temperature: wc.MessageOptions.Temperature,
			},
		}
	}

	// send llm reqs
	// TODO: add a semaphore to limit the number of concurrent requests
	llmResps := make([]string, len(llmReqs))
	var wg sync.WaitGroup

	for i, llmReq := range llmReqs {
		wg.Add(1)
		go func(i int, llmReq llm.InferRequest) {
			defer wg.Done()
			llmResp, err := s.InferSync(ctx, llmReq)
			if err != nil {
				logger.Error("failed to infer", "err", err, "model_name", llmReq.ModelConfig.ModelName)
				return
			}
			llmResps[i] = llmResp
		}(i, llmReq)
	}
	wg.Wait()

	logger.Debug("got llm responses", "llmResps", llmResps)

	// create responses
	protoResults := make([]*pb.TestResult, len(llmResps))
	for i, llmResp := range llmResps {
		if llmResp == "" {
			continue
		}
		tr := TestResult{
			ID:                  xid.New().String(),
			TestCaseID:          testCaseID,
			Response:            llmResp,
			PromptVersionNumber: prompt.VersionNumber,
			ModelConfigName:     workspaceConfigs[i].ModelConfigName,
			MessageOptions:      workspaceConfigs[i].MessageOptions,
			WorkspaceConfigID:   workspaceConfigs[i].ID,
		}
		if err := s.db.Create(&tr).Error; err != nil {
			return nil, fmt.Errorf("failed to save test result: %w", err)
		}

		protoResults[i] = &pb.TestResult{
			Id:              tr.ID,
			Response:        llmResp,
			TestCaseId:      testCaseID,
			ModelConfigName: workspaceConfigs[i].ModelConfigName,
			MessageOptions: &pb.MessageOptions{
				MaxTokens:   int32(workspaceConfigs[i].MessageOptions.MaxTokens),
				Temperature: workspaceConfigs[i].MessageOptions.Temperature,
			},
			PromptVersionNumber: prompt.VersionNumber,
			WorkspaceConfigId:   workspaceConfigs[i].ID,
		}
	}

	res := connect.NewResponse(&pb.EvaluationResponse{
		Result: protoResults,
	})

	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) SyntheticGeneration(ctx context.Context, req *connect.Request[pb.SyntheticGenerationRequest]) (*connect.Response[pb.EvaluationResponse], error) {
	logger := logutil.LoggerFromContext(ctx)
	logger.Debug("synthetic generation request", "req", req.Msg)

	var workspace Workspace
	if err := s.db.Preload("Prompts").Preload("WorkspaceConfigs").Preload("SystemPrompts").First(&workspace, "id = ?", req.Msg.WorkspaceId).Error; err != nil {
		return nil, fmt.Errorf("workspace not found: %w", err)
	}

	// Get all test cases for the workspace
	var testCases []TestCase
	if err := s.db.Where("workspace_id = ?", workspace.ID).Find(&testCases).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch test cases: %w", err)
	}

	// Get the active workspace config (assuming only one is active for synthetic generation)
	var activeConfig WorkspaceConfig
	for _, wc := range workspace.WorkspaceConfigs {
		if wc.Active {
			activeConfig = wc
			break
		}
	}
	if activeConfig.ID == "" {
		return nil, fmt.Errorf("no active workspace config found")
	}

	modelConfig, ok := s.models.GetConfig(activeConfig.ModelConfigName)
	if !ok {
		return nil, fmt.Errorf("model config %s not found", activeConfig.ModelConfigName)
	}

	prompt := workspace.PromptByVersion(req.Msg.VersionNumber)
	systemPrompt := workspace.SystemPromptByVersion(req.Msg.SystemPromptVersionNumber)

	// Prepare base messages (system prompt + user prompt)
	baseMessages := make([]llm.InferMessage, 0)
	if systemPrompt != nil {
		shouldCache := len(testCases) > 5
		baseMessages = append(baseMessages, llm.InferMessage{Content: systemPrompt.Content, Role: "system", ShouldCache: shouldCache})
	}

	var wg sync.WaitGroup
	sem := semaphore.NewWeighted(2) // Limit to 2 concurrent processes
	resultsChan := make(chan *pb.TestResult, len(testCases))

	for _, testCase := range testCases {
		wg.Add(1)
		go func(tc TestCase) {
			defer wg.Done()

			if err := sem.Acquire(ctx, 1); err != nil {
				logger.Error("failed to acquire semaphore", "err", err)
				return
			}
			defer sem.Release(1)

			result, err := s.processSingleTestCase(ctx, tc, prompt, baseMessages, activeConfig, modelConfig)
			if err != nil {
				logger.Error("failed to process test case", "err", err, "test_case_id", tc.ID)
				return
			}

			resultsChan <- result
		}(testCase)
	}

	wg.Wait()
	close(resultsChan)

	var protoResults []*pb.TestResult
	for result := range resultsChan {
		protoResults = append(protoResults, result)
	}

	res := connect.NewResponse(&pb.EvaluationResponse{
		Result: protoResults,
	})

	res.Header().Set("Synthetic-Gen-Version", "v1")
	return res, nil
}

func (s *Service) processSingleTestCase(ctx context.Context, testCase TestCase, prompt *Prompt, baseMessages []llm.InferMessage, activeConfig WorkspaceConfig, modelConfig llm.ModelConfig) (*pb.TestResult, error) {
	// Replace variables in the prompt
	vars := make(map[string]string)
	for k, v := range testCase.VariableValues {
		if v.TextValue != nil {
			vars[k] = *v.TextValue
		}
		// TODO: Handle image values if needed
	}
	promptStr := llmutils.ReplacePromptVariables(prompt.Content, vars)

	// Create LLM request
	messages := append(baseMessages, llm.InferMessage{Content: promptStr, Role: "user", ShouldCache: true})
	llmReq := llm.InferRequest{
		ModelConfig: modelConfig,
		Messages:    messages,
		MessageOptions: llm.MessageOptions{
			MaxTokens:   int(activeConfig.MessageOptions.MaxTokens),
			Temperature: activeConfig.MessageOptions.Temperature,
		},
	}

	// Send LLM request
	llmResp, err := s.InferSync(ctx, llmReq)
	if err != nil {
		return nil, fmt.Errorf("failed to infer: %w", err)
	}

	// Save the result
	tr := TestResult{
		ID:                  xid.New().String(),
		TestCaseID:          testCase.ID,
		Response:            llmResp,
		PromptVersionNumber: prompt.VersionNumber,
		ModelConfigName:     activeConfig.ModelConfigName,
		MessageOptions:      activeConfig.MessageOptions,
		WorkspaceConfigID:   activeConfig.ID,
	}
	if err := s.db.Create(&tr).Error; err != nil {
		return nil, fmt.Errorf("failed to save test result: %w", err)
	}

	testCase.HasBeenEvaluated = true
	if err := s.db.Save(&testCase).Error; err != nil {
		return nil, fmt.Errorf("failed to save test case: %w", err)
	}

	return &pb.TestResult{
		Id:              tr.ID,
		Response:        llmResp,
		TestCaseId:      testCase.ID,
		ModelConfigName: activeConfig.ModelConfigName,
		MessageOptions: &pb.MessageOptions{
			MaxTokens:   int32(activeConfig.MessageOptions.MaxTokens),
			Temperature: activeConfig.MessageOptions.Temperature,
		},
		PromptVersionNumber: prompt.VersionNumber,
		WorkspaceConfigId:   activeConfig.ID,
	}, nil
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
