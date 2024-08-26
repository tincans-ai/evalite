package eval

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"github.com/rs/xid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"time"
)

type Variables []Variable

type Variable struct {
	Name string       `json:"name"`
	Type VariableType `json:"type"`
}

func (v *Variable) Scan(value interface{}) error {
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("failed to unmarshal JSONB value: %v", value)
	}

	var temp Variable
	err := json.Unmarshal(bytes, &temp)
	if err != nil {
		return err
	}
	*v = temp
	return nil
}

func (v Variable) Value() (driver.Value, error) {
	if v.Name == "" {
		return nil, nil
	}
	return json.Marshal(v)
}

type VariableType string

const (
	VariableTypeText  VariableType = "TEXT"
	VariableTypeImage VariableType = "IMAGE"
	// Add other types as needed
)

type Workspace struct {
	ID                         string                      `gorm:"primarykey"`
	Name                       string                      `gorm:"not null"`
	ModelConfigNames           datatypes.JSONSlice[string] `gorm:"type:json"`
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
	Prompts                    []Prompt          `gorm:"foreignKey:WorkspaceID"`
	WorkspaceConfigs           []WorkspaceConfig `gorm:"foreignKey:WorkspaceID"`
	CurrentPromptVersionNumber uint32
	ActiveVersionNumbers       datatypes.JSONSlice[uint32]
	XMLMode                    bool
}

type WorkspaceConfig struct {
	ID              string         `gorm:"primarykey"`
	WorkspaceID     string         `gorm:"index"`
	Name            string         `gorm:"not null"`
	ModelConfigName string         `gorm:"not null"`
	MessageOptions  MessageOptions `gorm:"embedded"`
	Active          bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (w *Workspace) CreateWorkspaceConfig(name string, modelConfigName string, messageOptions MessageOptions) WorkspaceConfig {
	return WorkspaceConfig{
		ID:              xid.New().String(),
		WorkspaceID:     w.ID,
		Name:            name,
		ModelConfigName: modelConfigName,
		MessageOptions:  messageOptions,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
}

type MessageOptions struct {
	MaxTokens   int32   `gorm:"column:max_tokens"`
	Temperature float32 `gorm:"column:temperature"`
}

type Prompt struct {
	VersionNumber uint32
	Content       string
	Variables     datatypes.JSONSlice[Variable] `gorm:"type:json"`
	CreatedAt     time.Time
	WorkspaceID   string `gorm:"index"`
}

func (w *Workspace) BeforeCreate(tx *gorm.DB) error {
	w.CurrentPromptVersionNumber = 0
	return nil
}

func (w *Workspace) CreatePrompt(content string, variables []Variable) Prompt {
	w.CurrentPromptVersionNumber++
	p := Prompt{
		WorkspaceID:   w.ID,
		VersionNumber: w.CurrentPromptVersionNumber,
		Content:       content,
		Variables:     datatypes.JSONSlice[Variable](variables),
		CreatedAt:     time.Now(),
	}
	w.ActiveVersionNumbers = append(w.ActiveVersionNumbers, w.CurrentPromptVersionNumber)
	return p
}

func (w *Workspace) CurrentPrompt() *Prompt {
	for _, p := range w.Prompts {
		if p.VersionNumber == w.CurrentPromptVersionNumber {
			return &p
		}
	}
	return nil
}

func (w *Workspace) PromptByVersion(version uint32) *Prompt {
	for _, p := range w.Prompts {
		if p.VersionNumber == version {
			return &p
		}
	}
	return nil
}

type TestResult struct {
	ID                  string `gorm:"primarykey"`
	TestCaseID          string `gorm:"index"`
	Response            string
	PromptVersionNumber uint32
	ModelConfigName     string
	WorkspaceConfigID   string
	Rating              int32
	MessageOptions      MessageOptions `gorm:"embedded"`
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type VariableValues map[string]VariableValue

type TestCase struct {
	gorm.Model
	ID               string `gorm:"primarykey"`
	WorkspaceID      string
	VariableValues   VariableValues `gorm:"serializer:json"`
	HasBeenEvaluated bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type VariableValue struct {
	TextValue  *string `json:"text_value,omitempty"`
	ImageValue []byte  `json:"image_value,omitempty"`
	// Add other type values as needed
}

// Scan implements the sql.Scanner interface for VariableValues
func (vv *VariableValues) Scan(value interface{}) error {
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("type assertion to []byte failed")
	}

	return json.Unmarshal(bytes, &vv)
}

// Value implements the driver.Valuer interface for VariableValues
func (vv VariableValues) Value() (driver.Value, error) {
	return json.Marshal(vv)
}
