package eval

import (
	"connectrpc.com/connect"
	"context"
	_ "embed"
	"encoding/xml"
	"fmt"
	"github.com/rs/xid"
	"github.com/stillmatic/gollum/packages/llm"
	"github.com/tincans-ai/evalite/gen/eval/v1"
	"github.com/tincans-ai/evalite/packages/llmutils"
	"github.com/tincans-ai/evalite/packages/logutil"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"math"
	"strings"
)

func variableValuesToProto(vv VariableValues) map[string]*evalv1.VariableValue {
	variableValues := make(map[string]*evalv1.VariableValue, len(vv))
	for k, v := range vv {
		var val evalv1.VariableValue
		if len(v.ImageValue) > 0 {
			val = evalv1.VariableValue{Value: &evalv1.VariableValue_ImageValue{ImageValue: v.ImageValue}}
		} else {
			val = evalv1.VariableValue{Value: &evalv1.VariableValue_TextValue{TextValue: *v.TextValue}}
		}
		variableValues[k] = &val
	}
	return variableValues
}

func variableValuesFromProto(vv map[string]*evalv1.VariableValue) VariableValues {
	variableValues := make(map[string]VariableValue, len(vv))
	for k, v := range vv {
		var val VariableValue
		switch v.Value.(type) {
		case *evalv1.VariableValue_ImageValue:
			val = VariableValue{ImageValue: v.GetImageValue()}
		case *evalv1.VariableValue_TextValue:
			tv := v.GetTextValue()
			val = VariableValue{TextValue: &tv}
		}
		variableValues[k] = val
	}
	return variableValues
}

func (s *Service) ListTestCases(ctx context.Context, req *connect.Request[evalv1.ListTestCasesRequest]) (*connect.Response[evalv1.ListTestCasesResponse], error) {
	var testCases []TestCase
	var totalCount int64

	offset := (req.Msg.Page - 1) * req.Msg.PageSize
	limit := req.Msg.PageSize

	query := s.db.Model(&TestCase{})
	if req.Msg.WorkspaceId != "" {
		query = query.Where("workspace_id = ?", req.Msg.WorkspaceId)
	}

	query.Count(&totalCount)
	result := query.Offset(int(offset)).Limit(int(limit)).Find(&testCases)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list test cases: %v", result.Error))
	}

	testResults := make([]*evalv1.TestResult, 0)
	for _, tc := range testCases {
		var results []TestResult
		result := s.db.Model(&TestResult{}).Where("test_case_id = ?", tc.ID).Find(&results)
		if result.Error != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to load test results: %v", result.Error))
		}
		for _, tr := range results {
			testResults = append(testResults, &evalv1.TestResult{
				Id:                  tr.ID,
				TestCaseId:          tr.TestCaseID,
				CreatedAt:           timestamppb.New(tc.CreatedAt),
				UpdatedAt:           timestamppb.New(tc.UpdatedAt),
				Response:            tr.Response,
				ModelConfigName:     tr.ModelConfigName,
				PromptVersionNumber: tr.PromptVersionNumber,
				MessageOptions: &evalv1.MessageOptions{
					MaxTokens:   tr.MessageOptions.MaxTokens,
					Temperature: tr.MessageOptions.Temperature,
				},
				WorkspaceConfigId: tr.WorkspaceConfigID,
			})
		}

	}

	pbTestCases := make([]*evalv1.TestCase, len(testCases))
	for i, tc := range testCases {
		variableValues := variableValuesToProto(tc.VariableValues)
		pbTestCases[i] = &evalv1.TestCase{
			Id:               tc.ID,
			WorkspaceId:      tc.WorkspaceID,
			VariableValues:   variableValues,
			CreatedAt:        timestamppb.New(tc.CreatedAt),
			UpdatedAt:        timestamppb.New(tc.UpdatedAt),
			HasBeenEvaluated: tc.HasBeenEvaluated,
		}
	}

	res := connect.NewResponse(&evalv1.ListTestCasesResponse{
		TestCases:   pbTestCases,
		TotalCount:  int32(totalCount),
		TestResults: testResults,
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) CreateTestCase(ctx context.Context, req *connect.Request[evalv1.CreateTestCaseRequest]) (*connect.Response[evalv1.CreateTestCaseResponse], error) {
	testCase := &TestCase{
		ID:             xid.New().String(),
		WorkspaceID:    req.Msg.WorkspaceId,
		VariableValues: variableValuesFromProto(req.Msg.VariableValues),
	}
	result := s.db.Create(testCase)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create test case: %v", result.Error))
	}

	res := connect.NewResponse(&evalv1.CreateTestCaseResponse{
		TestCase: &evalv1.TestCase{
			Id:             testCase.ID,
			WorkspaceId:    testCase.WorkspaceID,
			VariableValues: variableValuesToProto(testCase.VariableValues),
			CreatedAt:      timestamppb.New(testCase.CreatedAt),
			UpdatedAt:      timestamppb.New(testCase.UpdatedAt),
		},
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

//go:embed prompts/generate_test_case_prompt.txt
var generateTestCasePrompt string

type variableKV struct {
	VariableKey   string `xml:"variable_key"`
	VariableValue string `xml:"variable_value"`
}

type generatedTestCaseOutput struct {
	XMLName                xml.Name     `xml:"reply"`
	Summary                string       `xml:"summary"`
	VariableConsiderations string       `xml:"variable_considerations"`
	TestCase               []variableKV `xml:"test_cases>case"`
}

// GenerateTestCase generates a test case based on the given input.
func (s *Service) GenerateTestCase(ctx context.Context, req *connect.Request[evalv1.GenerateTestCaseRequest]) (*connect.Response[evalv1.GenerateTestCaseResponse], error) {
	logger := logutil.LoggerFromContext(ctx)

	modelConfig, ok := s.models.GetConfig(s.defaultSmallModelConfig)
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model config %s not found", s.defaultSmallModelConfig))
	}

	// load workspace
	var workspace Workspace
	result := s.db.Model(&Workspace{}).Where("id = ?", req.Msg.WorkspaceId).First(&workspace)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to load workspace: %v", result.Error))
	}

	var promptVersion Prompt
	s.db.Model(&Prompt{}).Where("workspace_id = ? AND version_number = ?", workspace.ID, req.Msg.VersionNumber).First(&promptVersion)

	if promptVersion.VersionNumber == 0 {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("prompt version %d not found", req.Msg.VersionNumber))
	}

	variableSb := strings.Builder{}
	for _, v := range promptVersion.Variables {
		variableSb.WriteString("- ")
		variableSb.WriteString(v.Name)
		variableSb.WriteString("\n")
	}

	var testCases []TestCase
	result = s.db.Model(&TestCase{}).Where("workspace_id = ?", req.Msg.WorkspaceId).Find(&testCases)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to load test cases: %v", result.Error))
	}

	exampleValuesSb := strings.Builder{}
	nExamples := int(math.Min(float64(len(testCases)), 3))
	for i, tc := range testCases {
		if i >= nExamples {
			break
		}

		exampleValuesSb.WriteString("- ")
		for k, v := range tc.VariableValues {
			exampleValuesSb.WriteString(k)
			exampleValuesSb.WriteString(": ")
			if v.TextValue != nil {
				exampleValuesSb.WriteString(*v.TextValue)
			} else {
				exampleValuesSb.WriteString("image")
			}
			exampleValuesSb.WriteString(", ")
		}
		exampleValuesSb.WriteString("\n")
	}

	vars := map[string]string{
		"PROMPT_TEMPLATE": promptVersion.Content,
		"VARIABLES":       variableSb.String(),
		"EXAMPLE_VALUES":  exampleValuesSb.String(),
	}
	llmPrompt := llmutils.ReplacePromptVariables(generateTestCasePrompt, vars)

	logger.Debug("inferring prompt", "prompt", llmPrompt, "vars", vars)

	msgs := []llm.InferMessage{
		{
			Content: llmPrompt,
			Role:    "user",
		},
	}

	llmReq := llm.InferRequest{
		ModelConfig: modelConfig,
		Messages:    msgs,
		MessageOptions: llm.MessageOptions{
			MaxTokens:   768,
			Temperature: 1.2,
		},
	}

	resp, err := s.InferSync(ctx, llmReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate prompt: %v", err))
	}

	logger.Debug("got response", "resp", resp)

	parsedOutput, err := llmutils.ParseResponse[generatedTestCaseOutput](resp)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to parse response: %v", err))
	}
	outVars := make(map[string]*evalv1.VariableValue)
	for _, kv := range parsedOutput.TestCase {
		outVars[strings.TrimSpace(kv.VariableKey)] = &evalv1.VariableValue{Value: &evalv1.VariableValue_TextValue{TextValue: strings.TrimSpace(kv.VariableValue)}}
	}

	tc := &TestCase{
		ID:               xid.New().String(),
		WorkspaceID:      req.Msg.WorkspaceId,
		VariableValues:   variableValuesFromProto(outVars),
		HasBeenEvaluated: false,
	}
	tcResult := s.db.Create(tc)
	if tcResult.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create test case: %v", tcResult.Error))
	}

	res := connect.NewResponse(&evalv1.GenerateTestCaseResponse{
		TestCase: &evalv1.TestCase{
			Id:               tc.ID,
			WorkspaceId:      tc.WorkspaceID,
			VariableValues:   outVars,
			HasBeenEvaluated: tc.HasBeenEvaluated,
		}})

	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) DeleteTestCase(ctx context.Context, req *connect.Request[evalv1.DeleteTestCaseRequest]) (*connect.Response[emptypb.Empty], error) {
	result := s.db.Where("id = ?", req.Msg.Id).Delete(&TestCase{})
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete test case: %v", result.Error))
	}

	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}
