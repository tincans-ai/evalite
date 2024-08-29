package providerstore

import (
	"context"
	"github.com/stillmatic/gollum/packages/llm"
	"github.com/stillmatic/gollum/packages/llm/providers/anthropic"
	"github.com/stillmatic/gollum/packages/llm/providers/google"
	"github.com/stillmatic/gollum/packages/llm/providers/openai"
	"github.com/stillmatic/gollum/packages/llm/providers/vertex"
	"os"
)

type ProviderStore struct {
	providers map[llm.ProviderType]llm.Responder
}

func (p *ProviderStore) GetProvider(providerType llm.ProviderType) llm.Responder {
	return p.providers[providerType]
}

func (p *ProviderStore) AddProvider(providerType llm.ProviderType, provider llm.Responder) {
	p.providers[providerType] = provider
}

func (p *ProviderStore) ListProviders() []llm.ProviderType {
	l := make([]llm.ProviderType, 0, len(p.providers))
	for k := range p.providers {
		l = append(l, k)
	}
	return l
}

// NewProviderStore creates a new ProviderStore with all available providers
func NewProviderStore() *ProviderStore {
	p := &ProviderStore{
		providers: make(map[llm.ProviderType]llm.Responder),
	}

	anthropicAPIKey := os.Getenv("ANTHROPIC_API_KEY")
	if anthropicAPIKey != "" {
		p.AddProvider(llm.ProviderAnthropic, anthropic.NewAnthropicProvider(anthropicAPIKey))
	}

	openaiAPIKey := os.Getenv("OPENAI_API_KEY")
	if openaiAPIKey != "" {
		p.AddProvider(llm.ProviderOpenAI, openai.NewOpenAIProvider(openaiAPIKey))
	}

	googleAPIKey := os.Getenv("GOOGLE_API_KEY")
	if googleAPIKey != "" {
		gp, err := google.NewGoogleProvider(context.Background(), googleAPIKey)
		if err != nil {
			panic(err)
		}
		p.AddProvider(llm.ProviderGoogle, gp)
	}

	groqAPIKey := os.Getenv("GROQ_API_KEY")
	if groqAPIKey != "" {
		p.AddProvider(llm.ProviderGroq, openai.NewGroqProvider(groqAPIKey))
	}

	vertexRegion := os.Getenv("VERTEX_REGION")
	vertexProjectID := os.Getenv("VERTEX_PROJECT_ID")
	if vertexRegion != "" && vertexProjectID != "" {
		vertexProvider, err := vertex.NewVertexAIProvider(context.Background(), vertexProjectID, vertexRegion)
		if err != nil {
			panic(err)
		}
		p.AddProvider(llm.ProviderVertex, vertexProvider)
	}
	// TODO:add the other providers here

	return p
}
