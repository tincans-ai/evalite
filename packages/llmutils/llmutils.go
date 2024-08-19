package llmutils

import (
	"encoding/xml"
	"fmt"
	"github.com/pkg/errors"
	"html"
	"reflect"
	"regexp"
	"strings"
)

func ReplacePromptVariables(prompt string, variables map[string]string) string {
	// Create a regular expression to match {{VARIABLE_NAME}}
	re := regexp.MustCompile(`\{\{([A-Z_]+)\}\}`)

	// Use a function to replace each match
	result := re.ReplaceAllStringFunc(prompt, func(match string) string {
		// Extract the variable name without the curly braces
		varName := strings.Trim(match, "{}")

		// Look up the value in the variables map
		if value, ok := variables[varName]; ok {
			return value
		}
		// If the variable is not found, return the original match
		return match
	})

	return result
}

// wrapWithCDATA wraps the content of specified tags with CDATA sections
func wrapWithCDATA(input string, tags []string) string {
	for _, tag := range tags {
		regex := regexp.MustCompile(fmt.Sprintf(`<%s>([\s\S]*?)</%s>`, tag, tag))
		input = regex.ReplaceAllStringFunc(input, func(match string) string {
			content := regex.FindStringSubmatch(match)[1]
			return fmt.Sprintf("<%s><![CDATA[%s]]></%s>", tag, content, tag)
		})
	}
	return input
}

// getXMLTags uses reflection to get XML tag names from a struct
func getXMLTags[T any]() []string {
	var t T
	v := reflect.ValueOf(t)
	var tags []string

	for i := 0; i < v.NumField(); i++ {
		field := v.Type().Field(i)
		xmlTag := field.Tag.Get("xml")
		if xmlTag != "" && xmlTag != "-" && xmlTag != "reply" {
			tags = append(tags, strings.Split(xmlTag, ",")[0])
		}
	}

	return tags
}

// wrapStructFieldsWithCDATA is a generic function that wraps XML content with CDATA
// based on the struct fields
func wrapStructFieldsWithCDATA[T any](input string) string {
	tags := getXMLTags[T]()

	return wrapWithCDATA(input, tags)
}

func removeCDATA(input string) string {
	// First, unescape HTML entities
	unescaped := html.UnescapeString(input)

	// Then remove CDATA tags
	cdataRegex := regexp.MustCompile(`<!\[CDATA\[([\s\S]*?)\]\]>`)
	return cdataRegex.ReplaceAllString(unescaped, "$1")
}

func ParseResponse[T any](input string) (T, error) {
	var response T

	// Wrap content of all fields with CDATA
	wrappedInput := wrapStructFieldsWithCDATA[T](input)

	decoder := xml.NewDecoder(strings.NewReader(wrappedInput))
	decoder.Strict = false

	err := decoder.Decode(&response)
	if err != nil {
		return response, errors.Wrap(err, "failed to decode XML response")
	}

	// Remove CDATA, unescape HTML, and trim whitespace for each field
	v := reflect.ValueOf(&response).Elem()
	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		if field.Kind() == reflect.String {
			cleanedValue := strings.TrimSpace(removeCDATA(field.String()))
			field.SetString(cleanedValue)
		}
	}

	return response, nil
}
