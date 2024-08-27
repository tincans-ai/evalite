package eval

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"fmt"
	"github.com/rs/xid"
	"github.com/tincans-ai/evalite/gen/eval/v1"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func (s *Service) CreateWorkspace(ctx context.Context, req *connect.Request[evalv1.CreateWorkspaceRequest]) (*connect.Response[evalv1.CreateWorkspaceResponse], error) {
	var wkspName string
	if req.Msg.Name == "" {
		name, err := s.GetNameForWorkspace(ctx, req.Msg.Content)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get workspace name: %v", err))
		}
		wkspName = name
	} else {
		wkspName = req.Msg.Name
	}

	workspace := &Workspace{
		ID:      xid.New().String(),
		Name:    wkspName,
		Prompts: make([]Prompt, 0),
	}

	variablesNames := parseDoubleBrackets(req.Msg.Content)
	variables := make([]Variable, 0)
	for _, name := range variablesNames {
		variables = append(variables, Variable{
			Name: name,
			Type: VariableTypeText,
		})
	}

	result := s.db.Create(workspace)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create workspace: %v", result.Error))
	}

	prompt := workspace.CreatePrompt(req.Msg.Content, variables)
	s.db.Create(prompt)

	workspace.CurrentPromptVersionNumber = prompt.VersionNumber
	s.db.Save(workspace)

	res := connect.NewResponse(&evalv1.CreateWorkspaceResponse{
		Workspace: &evalv1.Workspace{
			Id:                         workspace.ID,
			Name:                       workspace.Name,
			CreatedAt:                  timestamppb.New(workspace.CreatedAt),
			UpdatedAt:                  timestamppb.New(workspace.UpdatedAt),
			CurrentPromptVersionNumber: prompt.VersionNumber,
			Prompts: []*evalv1.Workspace_Prompt{
				{
					VersionNumber: prompt.VersionNumber,
					Content:       prompt.Content,
					Variables:     variablesToProtobuf(prompt.Variables),
					CreatedAt:     timestamppb.New(prompt.CreatedAt),
				},
			},
			ActiveVersionNumbers: []uint32{prompt.VersionNumber},
		},
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func variablesToProtobuf(variables datatypes.JSONSlice[Variable]) []*evalv1.Variable {
	protoVars := make([]*evalv1.Variable, len(variables))
	for i, v := range variables {
		switch v.Type {
		case VariableTypeText:
			protoVars[i] = &evalv1.Variable{
				Name: v.Name,
				Type: evalv1.VariableType_TEXT,
			}
		case VariableTypeImage:
			protoVars[i] = &evalv1.Variable{
				Name: v.Name,
				Type: evalv1.VariableType_IMAGE,
			}
		}
	}
	return protoVars
}

func (s *Service) GetWorkspace(ctx context.Context, req *connect.Request[evalv1.GetWorkspaceRequest]) (*connect.Response[evalv1.GetWorkspaceResponse], error) {
	var workspace Workspace
	result := s.db.Preload("Prompts").Preload("WorkspaceConfigs").First(&workspace, "id = ?", req.Msg.Id)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("workspace not found: %v", result.Error))
	}

	protoPrompts := make([]*evalv1.Workspace_Prompt, len(workspace.Prompts))
	for i, prompt := range workspace.Prompts {
		protoPrompts[i] = &evalv1.Workspace_Prompt{
			VersionNumber: prompt.VersionNumber,
			Content:       prompt.Content,
			Variables:     variablesToProtobuf(prompt.Variables),
			CreatedAt:     timestamppb.New(prompt.CreatedAt),
		}
	}
	workspaceConfigs := make([]*evalv1.WorkspaceConfig, len(workspace.WorkspaceConfigs))
	for i, config := range workspace.WorkspaceConfigs {
		workspaceConfigs[i] = &evalv1.WorkspaceConfig{
			Id:              config.ID,
			Name:            config.Name,
			ModelConfigName: config.ModelConfigName,
			MessageOptions: &evalv1.MessageOptions{
				MaxTokens:   config.MessageOptions.MaxTokens,
				Temperature: config.MessageOptions.Temperature,
			},
			Active: config.Active,
		}
	}

	res := connect.NewResponse(&evalv1.GetWorkspaceResponse{
		Workspace: &evalv1.Workspace{
			Id:                         workspace.ID,
			Name:                       workspace.Name,
			ModelConfigNames:           workspace.ModelConfigNames,
			CreatedAt:                  timestamppb.New(workspace.CreatedAt),
			UpdatedAt:                  timestamppb.New(workspace.UpdatedAt),
			Prompts:                    protoPrompts,
			CurrentPromptVersionNumber: workspace.CurrentPromptVersionNumber,
			WorkspaceConfigs:           workspaceConfigs,
			ActiveVersionNumbers:       workspace.ActiveVersionNumbers,
			XMLMode:                    workspace.XMLMode,
		},
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) ListWorkspaces(ctx context.Context, req *connect.Request[evalv1.ListWorkspacesRequest]) (*connect.Response[evalv1.ListWorkspacesResponse], error) {
	var workspaces []Workspace
	var totalCount int64

	offset := (req.Msg.Page - 1) * req.Msg.PageSize
	limit := req.Msg.PageSize

	s.db.Model(&Workspace{}).Count(&totalCount)
	result := s.db.Offset(int(offset)).Limit(int(limit)).Find(&workspaces)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list workspaces: %v", result.Error))
	}

	pbWorkspaces := make([]*evalv1.Workspace, len(workspaces))
	for i, w := range workspaces {
		pbWorkspaces[i] = &evalv1.Workspace{
			Id:        w.ID,
			Name:      w.Name,
			CreatedAt: timestamppb.New(w.CreatedAt),
			UpdatedAt: timestamppb.New(w.UpdatedAt),
		}
	}

	res := connect.NewResponse(&evalv1.ListWorkspacesResponse{
		Workspaces: pbWorkspaces,
		TotalCount: int32(totalCount),
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) CreateWorkspaceConfig(ctx context.Context, req *connect.Request[evalv1.CreateWorkspaceConfigRequest]) (*connect.Response[evalv1.CreateWorkspaceConfigResponse], error) {
	var workspace Workspace
	result := s.db.First(&workspace, "id = ?", req.Msg.WorkspaceId)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("workspace not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch workspace: %w", result.Error))
	}

	wc := WorkspaceConfig{
		ID:              xid.New().String(),
		WorkspaceID:     workspace.ID,
		Name:            req.Msg.Name,
		ModelConfigName: req.Msg.ModelConfigName,
		MessageOptions: MessageOptions{
			MaxTokens:   req.Msg.MessageOptions.MaxTokens,
			Temperature: req.Msg.MessageOptions.Temperature,
		},
		Active: true,
	}

	result = s.db.Create(&wc)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create workspace config: %w", result.Error))
	}

	res := connect.NewResponse(&evalv1.CreateWorkspaceConfigResponse{
		WorkspaceConfig: &evalv1.WorkspaceConfig{
			Id:              wc.ID,
			Name:            wc.Name,
			ModelConfigName: wc.ModelConfigName,
			MessageOptions: &evalv1.MessageOptions{
				MaxTokens:   wc.MessageOptions.MaxTokens,
				Temperature: wc.MessageOptions.Temperature,
			},
			CreatedAt: timestamppb.New(wc.CreatedAt),
			UpdatedAt: timestamppb.New(wc.UpdatedAt),
			Active:    true,
		},
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) DeleteWorkspaceConfig(ctx context.Context, req *connect.Request[evalv1.DeleteWorkspaceConfigRequest]) (*connect.Response[emptypb.Empty], error) {
	var wc WorkspaceConfig
	result := s.db.First(&wc, "id = ?", req.Msg.WorkspaceConfigId)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("workspace config not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch workspace config: %w", result.Error))
	}

	result = s.db.Delete(&wc)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete workspace config: %w", result.Error))
	}

	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) SetWorkspaceConfigActive(ctx context.Context, req *connect.Request[evalv1.SetWorkspaceConfigActiveRequest]) (*connect.Response[emptypb.Empty], error) {
	var wc WorkspaceConfig
	result := s.db.First(&wc, "id = ?", req.Msg.WorkspaceConfigId)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("workspace config %s not found", req.Msg.WorkspaceConfigId))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch workspace config: %w", result.Error))
	}

	if wc.WorkspaceID != req.Msg.WorkspaceId {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workspace config does not belong to workspace"))
	}

	wc.Active = req.Msg.Active

	result = s.db.Save(&wc)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to save workspace: %w", result.Error))
	}

	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) SetVersionActive(ctx context.Context, req *connect.Request[evalv1.SetVersionActiveRequest]) (*connect.Response[emptypb.Empty], error) {
	var workspace Workspace
	result := s.db.First(&workspace, "id = ?", req.Msg.WorkspaceId)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("workspace not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch workspace: %w", result.Error))
	}
	if !req.Msg.Active {
		//delete req.Msg.VersionNumber from workspace.active_version_numbers if it's in there
		newActiveVersionNumbers := make([]uint32, 0)
		for _, versionNumber := range workspace.ActiveVersionNumbers {
			if versionNumber != req.Msg.VersionNumber {
				newActiveVersionNumbers = append(newActiveVersionNumbers, versionNumber)
			}
		}
		workspace.ActiveVersionNumbers = newActiveVersionNumbers
	} else {
		// check if version number exists in active numbers
		found := false
		for _, versionNumber := range workspace.ActiveVersionNumbers {
			if versionNumber == req.Msg.VersionNumber {
				found = true
				break
			}
		}
		if !found {
			workspace.ActiveVersionNumbers = append(workspace.ActiveVersionNumbers, req.Msg.VersionNumber)
		}
	}

	result = s.db.Save(&workspace)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to save prompt: %w", result.Error))
	}

	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) SetXMLMode(ctx context.Context, req *connect.Request[evalv1.SetXMLModeRequest]) (*connect.Response[emptypb.Empty], error) {
	var workspace Workspace
	result := s.db.First(&workspace, "id = ?", req.Msg.WorkspaceId)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("workspace not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch workspace: %w", result.Error))
	}

	workspace.XMLMode = req.Msg.XMLMode

	result = s.db.Save(&workspace)
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to save workspace: %w", result.Error))
	}

	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}
