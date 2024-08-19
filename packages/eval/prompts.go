package eval

import (
	"connectrpc.com/connect"
	"context"
	"encoding/xml"
	"fmt"
	"github.com/stillmatic/gollum/packages/llm"
	"github.com/tincans-ai/evalite/gen/eval/v1"
	"github.com/tincans-ai/evalite/packages/llmutils"
	"github.com/tincans-ai/evalite/packages/logutil"
	"regexp"
	"strings"
)

type summarizePromptOutput struct {
	Reply    xml.Name `xml:"reply"`
	Thinking string   `xml:"thinking"`
	Title    string   `xml:"title"`
}

// GetNameForWorkspace prompts the small LLM model to generate a name for a prompt
func (s *Service) GetNameForWorkspace(ctx context.Context, promptInput string) (string, error) {
	logger := logutil.LoggerFromContext(ctx)

	defaultTitle := "Untitled"
	modelConfig, ok := s.models.GetConfig(s.defaultSmallModelConfig)
	if !ok {
		return defaultTitle, connect.NewError(connect.CodeNotFound, fmt.Errorf("model config %s not found", s.defaultSmallModelConfig))
	}

	vars := map[string]string{"PROMPT": promptInput}
	prompt := llmutils.ReplacePromptVariables(summarizePromptPrompt, vars)

	msgs := []llm.InferMessage{
		{
			Content: prompt,
			Role:    "user",
		},
	}

	llmReq := llm.InferRequest{
		ModelConfig: modelConfig,
		Messages:    msgs,
		MessageOptions: llm.MessageOptions{
			MaxTokens:   256,
			Temperature: 0.7,
		},
	}

	logger.Debug("inferring prompt", "prompt", prompt)

	resp, err := s.InferSync(ctx, llmReq)
	if err != nil {
		return defaultTitle, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate prompt: %v", err))
	}

	logger.Debug("response", "resp", resp)

	parsedOutput, err := llmutils.ParseResponse[summarizePromptOutput](resp)
	if err != nil {
		return defaultTitle, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to parse response: %v", err))
	}
	return parsedOutput.Title, nil
}

func parseDoubleBrackets(input string) []string {
	// Regular expression to match content inside double curly brackets
	re := regexp.MustCompile(`{{(.*?)}}`)

	// Find all matches
	matches := re.FindAllStringSubmatch(input, -1)

	// Extract the content from each match
	var result []string
	for _, match := range matches {
		if len(match) > 1 {
			// Trim any whitespace from the matched content
			content := strings.TrimSpace(match[1])
			result = append(result, content)
		}
	}

	return result
}

type genPromptOutput struct {
	Reply    xml.Name `xml:"reply"`
	Thinking string   `xml:"thinking"`
	Prompt   string   `xml:"prompt"`
}

func (s *Service) GeneratePrompt(ctx context.Context, req *connect.Request[evalv1.GeneratePromptRequest]) (*connect.Response[evalv1.GeneratePromptResponse], error) {
	logger := logutil.LoggerFromContext(ctx)
	modelConfig, ok := s.models.GetConfig(req.Msg.ModelConfigName)
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model config %s not found", req.Msg.ModelConfigName))
	}

	vars := map[string]string{"TASK_DESCRIPTION": req.Msg.Prompt}
	prompt := llmutils.ReplacePromptVariables(generatePromptPrompt, vars)

	msgs := []llm.InferMessage{
		{
			Content: prompt,
			Role:    "user",
		},
	}

	llmReq := llm.InferRequest{
		ModelConfig: modelConfig,
		Messages:    msgs,
		MessageOptions: llm.MessageOptions{
			MaxTokens:   1024,
			Temperature: 0.3,
		},
	}

	logger.Debug("inferring prompt", "prompt", prompt)

	resp, err := s.InferSync(ctx, llmReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate prompt: %v", err))
	}

	logger.Debug("response", "resp", resp)

	parsedOutput, err := llmutils.ParseResponse[genPromptOutput](resp)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to parse response: %v", err))
	}

	logger.Debug("parsed response", "resp", resp, "output", parsedOutput)

	res := connect.NewResponse(&evalv1.GeneratePromptResponse{
		GeneratedPrompt: parsedOutput.Prompt,
	})

	return res, nil
}

func (s *Service) UpdateWorkspace(ctx context.Context, req *connect.Request[evalv1.UpdateWorkspaceRequest]) (*connect.Response[evalv1.UpdateWorkspaceResponse], error) {
	var workspace Workspace
	s.db.First(&workspace, "id = ?", req.Msg.WorkspaceId)
	if req.Msg.NewTitle != nil {
		workspace.Name = *req.Msg.NewTitle
	}
	if err := s.db.Save(&workspace).Error; err != nil {
		return nil, err
	}

	// Create a new version
	variableNames := parseDoubleBrackets(req.Msg.NewContent)
	variables := make([]Variable, 0)
	for _, name := range variableNames {
		variables = append(variables, Variable{
			Name: name,
			Type: VariableTypeText,
		})
	}
	newVersion := workspace.CreatePrompt(req.Msg.NewContent, variables)
	s.db.Create(newVersion)

	// Save the new version and update the prompt
	if err := s.db.Save(&workspace).Error; err != nil {
		return nil, err
	}

	res := connect.NewResponse(&evalv1.UpdateWorkspaceResponse{
		NewVersionNumber: workspace.CurrentPromptVersionNumber,
		Content:          newVersion.Content,
	})
	return res, nil
}
