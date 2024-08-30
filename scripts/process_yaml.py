from ruamel.yaml import YAML
import xml.etree.ElementTree as ET
from typing import Dict, Any
import re

def custom_xml_parse(xml_string: str) -> Dict[str, Any]:
    # Simple regex-based parser
    tag_pattern = re.compile(r'<(\w+)>(.*?)</\1>', re.DOTALL)
    return {match.group(1): match.group(2).strip() for match in tag_pattern.finditer(xml_string)}

def process_yaml(input_file: str, output_file: str = "output.yaml"):
    yaml = YAML(typ='safe', pure=True)
    with open(input_file, 'r') as file:
        data = yaml.load(file)

    new_data = []

    for test_case in data['testCases']:
        new_test_case = { }

        # Expand variables
        for variable in data['variables']:
            var_name = variable['name']
            if var_name in test_case['variableValues']:
                new_test_case[var_name] = test_case['variableValues'][var_name]['value']['value'].strip()

        # Process results
        for result in test_case.get('results', []):
            xml_content = result['response']
            if "</reply>" not in xml_content:
                raise ValueError("Invalid XML content")
            xml_content = xml_content.replace("<reply>", "").replace("</reply>", "")

            try:
                parsed_xml = custom_xml_parse(xml_content)
                # upper case the keys
                parsed_xml = {key.upper(): value for key, value in parsed_xml.items()}
                new_test_case.update(parsed_xml)
            except Exception as e:
                print(f"Error parsing XML for test case {test_case['id']}: {e}")
                new_test_case['response'] = xml_content  # Fallback to storing raw content

        new_data.append(new_test_case)

    with open(output_file, 'w') as file:
        yaml.dump(new_data, file)

if __name__ == "__main__":
    import fire
    fire.Fire(process_yaml)
