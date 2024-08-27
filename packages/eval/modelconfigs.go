package eval

import (
	"connectrpc.com/connect"
	"context"
	"fmt"
	"github.com/stillmatic/gollum/packages/llm"
	"github.com/tincans-ai/evalite/gen/eval/v1"
	"google.golang.org/protobuf/types/known/emptypb"
)

func (s *Service) ListModelConfigs(ctx context.Context, req *connect.Request[emptypb.Empty]) (*connect.Response[evalv1.ListModelConfigsResponse], error) {
	modelConfigNames := s.models.GetConfigNames()

	providers := s.providers.ListProviders()
	// create a set of providers
	providerMap := make(map[llm.ProviderType]bool)
	for _, p := range providers {
		providerMap[p] = true
	}

	pbModelConfigs := make(map[string]*evalv1.ModelConfig)
	for _, m := range modelConfigNames {
		mc, _ := s.models.GetConfig(m)

		if _, ok := providerMap[mc.ProviderType]; !ok {
			continue
		}
		if mc.ModelType != llm.ModelTypeLLM {
			continue
		}

		pbModelConfigs[m] = &evalv1.ModelConfig{
			ProviderType: string(mc.ProviderType),
			ModelName:    mc.ModelName,
			BaseUrl:      mc.BaseURL,
		}
	}

	res := connect.NewResponse(&evalv1.ListModelConfigsResponse{
		ModelConfigs: pbModelConfigs,
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) SetDefaultSmallModelConfig(ctx context.Context, req *connect.Request[evalv1.SetDefaultSmallModelConfigRequest]) (*connect.Response[emptypb.Empty], error) {
	s.defaultSmallModelConfig = req.Msg.ModelConfigName
	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) SetDefaultLargeModelConfig(ctx context.Context, req *connect.Request[evalv1.SetDefaultLargeModelConfigRequest]) (*connect.Response[emptypb.Empty], error) {
	s.defaultLargeModelConfig = req.Msg.ModelConfigName
	res := connect.NewResponse(&emptypb.Empty{})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) GetDefaultSmallModelConfig(ctx context.Context, req *connect.Request[emptypb.Empty]) (*connect.Response[evalv1.GetModelConfigResponse], error) {
	mc, ok := s.models.GetConfig(s.defaultSmallModelConfig)
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model config %s not found", s.defaultSmallModelConfig))
	}
	res := connect.NewResponse(&evalv1.GetModelConfigResponse{
		ModelConfig: &evalv1.ModelConfig{
			ModelName:    mc.ModelName,
			ProviderType: string(mc.ProviderType),
			BaseUrl:      mc.BaseURL,
		},
		ModelConfigName: s.defaultSmallModelConfig,
	})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}

func (s *Service) GetDefaultLargeModelConfig(ctx context.Context, req *connect.Request[emptypb.Empty]) (*connect.Response[evalv1.GetModelConfigResponse], error) {
	mc, ok := s.models.GetConfig(s.defaultLargeModelConfig)
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model config %s not found", s.defaultLargeModelConfig))
	}
	res := connect.NewResponse(&evalv1.GetModelConfigResponse{
		ModelConfig: &evalv1.ModelConfig{
			ModelName:    mc.ModelName,
			ProviderType: string(mc.ProviderType),
			BaseUrl:      mc.BaseURL,
		},
		ModelConfigName: s.defaultLargeModelConfig})
	res.Header().Set("Eval-Version", "v1")
	return res, nil
}
