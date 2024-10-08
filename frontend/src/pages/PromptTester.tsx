import React, {useEffect, useState} from "react";
import {
    DeleteTestCaseRequest,
    EvaluationRequest,
    GenerateTestCaseRequest,
    GetWorkspaceResponse,
    ListTestCasesRequest,
    RateTestResultRequest,
    SyntheticGenerationRequest,
    TestCase,
    TestResult,
    Variable,
    VariableType,
    VariableValue,
    Workspace_Prompt,
    WorkspaceConfig,
} from "@/lib/gen/eval/v1/eval_pb.ts";
import {useConnectClient} from "@/providers/ConnectProvider.tsx";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Input} from "@/components/ui/input";
import ModelConfigDialog from "@/components/ModelConfigDialog.tsx";
import {Badge} from "@/components/ui/badge.tsx";
import XMLViewer from 'react-xml-viewer'
import {Copy, PlayIcon, ThumbsDown, ThumbsUp} from "lucide-react";
import {cn} from "@/lib/utils.ts";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select.tsx";
import yaml from 'js-yaml';


interface PromptTesterProps {
    workspaceId: string;
    workspace: GetWorkspaceResponse | undefined;
    version: Workspace_Prompt | undefined;
    activeVersions: Workspace_Prompt[];
    xmlMode: boolean;
}

type TestCaseWithoutMethods = Omit<TestCase, "toJSON" | "toProtobuf" | "clone">;
type EvaluationRequestWithoutMethods = Omit<
    EvaluationRequest,
    "toJson" | "toProtobuf" | "clone" | "toJSON"
>;
type ListTestCasesRequestWithoutMethods = Omit<
    ListTestCasesRequest,
    "toJSON" | "toProtobuf" | "clone" | "toJson"
>;

type TestResultWithoutMethods = Omit<TestResult, "toJSON" | "toProtobuf" | "clone">;

const EnhancedTableCell = ({matchingResult, xmlMode, versionNumber, onRunTest, handleRating, expanded}) => {
    const handleCopy = () => {
        navigator.clipboard.writeText(matchingResult?.response.replace(/\\n/g, '\n')).then(() => {
            // You can add a toast notification here if you want
            console.log('Copied to clipboard');
        });
    }

    const onThumbsUp = () => {
        handleRating(1, matchingResult?.id);
        matchingResult.rating = 1;
    }

    const onThumbsDown = () => {
        handleRating(-1, matchingResult?.id);
        matchingResult.rating = -1;
    }

    const ActionBar = ({onCopy, onRetry, onThumbsUp, onThumbsDown}) => {
        return (
            <div className="flex items-center space-x-2 rounded-md p-1">
                <Button variant="ghost" size="icon" onClick={onCopy} title="Copy">
                    <Copy className="h-4 w-4 text-gray-600"/>
                </Button>
                {/*<Button variant="ghost" size="icon" onClick={onRetry} title="Retry">*/}
                {/*    <RotateCcw className="h-4 w-4 text-gray-300" />*/}
                {/*</Button>*/}
                <div className="h-4 w-px bg-gray-600 mx-1"/>
                {/* Separator */}
                <Button variant="ghost" size="icon" onClick={onThumbsUp} title="Thumbs Up"
                        disabled={matchingResult?.rating === 1}>
                    <ThumbsUp className="h-4 w-4 text-gray-600"
                              color={matchingResult?.rating === 1 ? "green" : "gray"}/>
                </Button>
                <Button variant="ghost" size="icon" onClick={onThumbsDown} title="Thumbs Down"
                        disabled={matchingResult?.rating === -1}>
                    <ThumbsDown className="h-4 w-4 text-gray-600"
                                color={matchingResult?.rating === -1 ? "red" : "gray"}/>
                </Button>
            </div>
        );
    };

    const ContentRenderer = ({content, xmlMode}) => (

        <div
            className={cn(expanded ? "h-[960px]" : "h-[120px]", "overflow-auto max-w-md text-wrap text-xs items-start",)}>
            {xmlMode ? (
                <XMLViewer xml={content.replace(/\\n/g, '\n')} collapsible/>
            ) : (
                <pre className={"flex max-w-md text-wrap text-xs items-start"}>
                    {content.replace(/\\n/g, '\n')}
                </pre>
            )}
        </div>
    );

    return (
        <TableCell className="relative">
            {matchingResult ? (
                <div>
                    <ContentRenderer
                        content={matchingResult.response}
                        xmlMode={xmlMode}
                    />
                    <div className="flex flex-row justify-between mt-2 items-center">
                        <Badge variant="outline">
                            v{matchingResult.promptVersionNumber}
                        </Badge>
                        <ActionBar
                            onCopy={handleCopy}
                            onThumbsUp={onThumbsUp}
                            onThumbsDown={onThumbsDown}
                            onRetry={() => {}}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex flex-row justify-between items-center">
                    <Badge variant="outline">
                        v{versionNumber}
                    </Badge>

                    <div className={"flex"}>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onRunTest}
                        >
                            <PlayIcon className="mr-2 h-4 w-4"/>
                            Run
                        </Button>
                    </div>
                </div>
            )}
        </TableCell>
    );
};

const PromptTester: React.FC<PromptTesterProps> = ({
                                                       workspaceId,
                                                       workspace,
                                                       version,
                                                       activeVersions,
                                                       xmlMode,
                                                   }) => {
    const [testCases, setTestCases] = useState<TestCaseWithoutMethods[]>([]);
    const [testResults, setTestResults] = useState<TestResultWithoutMethods[]>([]);
    const [variables, setVariables] = useState<Variable[]>([]);
    const [activeConfigs, setActiveConfigs] = useState<WorkspaceConfig[]>([]);
    const [expandedRowNumber, setExpandedRowNumber] = useState<number>(-1);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [itemsPerPage, setItemsPerPage] = useState<number>(10);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [seedPrompt, setSeedPrompt] = useState<string>('');
    const client = useConnectClient();

    useEffect(() => {
        fetchTestCases();
    }, [workspaceId, client, currentPage, itemsPerPage]);

    const fetchTestCases = async () => {
        const req: Partial<ListTestCasesRequestWithoutMethods> = {
            workspaceId: workspaceId,
            page: currentPage,
            pageSize: itemsPerPage,
        };
        try {
            const response = await client.listTestCases(req);
            setTestCases(response.testCases);
            setTestResults(response.testResults);
            const totalPageCount = Math.ceil(response.totalCount / itemsPerPage);
            setTotalPages(totalPageCount);
        } catch (error) {
            console.error("Error fetching test cases:", error);
        }
    };

    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
    };

    const handleItemsPerPageChange = (newItemsPerPage: number) => {
        setItemsPerPage(newItemsPerPage);
        setCurrentPage(1); // Reset to first page when changing items per page
    };

    useEffect(() => {
        if (version?.variables) {
            setVariables(version.variables);
        }
        if (workspace?.workspace?.workspaceConfigs) {
            setActiveConfigs(
                workspace.workspace.workspaceConfigs.filter((c) => c.active),
            );
        }
    }, [version]);

    const handleExpandRow = (rowNumber: number) => {
        if (expandedRowNumber === rowNumber) {
            setExpandedRowNumber(-1);
            return;
        }
        setExpandedRowNumber(rowNumber);
    }

    const handleExportToYAML = () => {
        const exportData = {
            workspaceId,
            variables,
            testCases: testCases.map(testCase => ({
                ...testCase,
                results: testResults.filter(result => result.testCaseId === testCase.id).filter(result => activeConfigs.map(config => config.id).includes(result.workspaceConfigId))
            })),
        };

        const yamlString = yaml.dump(exportData, {
            skipInvalid: true,
            noRefs: true,
        });

        const blob = new Blob([yamlString], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `prompt_tester_export_${new Date().toISOString()}.yaml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleRunTest = async (
        testCase: TestCaseWithoutMethods,
        versionNumber: number,
    ) => {
        const updatedTestCase = {...testCase};

        try {
            const req: EvaluationRequestWithoutMethods = {
                workspaceId: workspaceId,
                testCase: testCase,
                versionNumber: versionNumber,
                systemPromptVersionNumber: workspace?.workspace?.currentSystemPromptVersionNumber,
            };
            const response = await client.evaluate(req);

            setTestResults((prevTestResults: TestCaseWithoutMethods[]) => [
                ...prevTestResults,
                ...response.result,
            ]);
        } catch (error) {
            console.error(`Error running test case:`, error);
        }

        setTestCases((prevTestCases: TestCaseWithoutMethods[]) =>
            prevTestCases.map((tc) => (tc.id === testCase.id ? updatedTestCase : tc)),
        );
    };

    const handleAddRow = () => {
        client.createTestCase({workspaceId: workspaceId}).then((response) => {
            setTestCases([...testCases, response.testCase]);
        })
    };

    const handleVariableTypeChange = (
        variableName: string,
        newType: VariableType,
    ) => {
        setVariables(
            variables.map((v: Variable) =>
                v.name === variableName ? {...v, type: newType} : v,
            ),
        );
    };

    const handleImportYAML = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const yamlContent = e.target?.result as string;
                const parsedData = yaml.load(yamlContent) as { [key: string]: any }[];

                for (const item of parsedData) {
                    const variableValues: { [key: string]: VariableValue } = {};

                    for (const [key, value] of Object.entries(item)) {
                        const variable = variables.find(v => v.name === key);
                        if (variable) {
                            switch (variable.type) {
                                case VariableType.TEXT:
                                    variableValues[key] = VariableValue.fromJson({ textValue: value as string });
                                    break;
                                case VariableType.IMAGE:
                                    // Assuming image values are base64 encoded strings in the YAML
                                    variableValues[key] = VariableValue.fromJson({ imageValue: value as string });
                                    break;
                            }
                        }
                    }

                    try {
                        const response = await client.createTestCase({
                            workspaceId: workspaceId,
                            variableValues: variableValues,
                        });
                        setTestCases(prevTestCases => [...prevTestCases, response.testCase]);
                    } catch (error) {
                        console.error("Error creating test case:", error);
                    }
                }
            } catch (error) {
                console.error("Error parsing YAML:", error);
            }
        };
        reader.readAsText(file);
    };


    const handleVariableValueChange = (
        testCaseId: string,
        variableName: string,
        newValue: VariableValue,
    ) => {
        setTestCases(
            testCases.map((tc: TestCaseWithoutMethods) =>
                tc.id === testCaseId
                    ? {
                        ...tc,
                        variableValues: {
                            ...tc.variableValues,
                            [variableName]: newValue,
                        },
                    }
                    : tc,
            ),
        );
    };

    const handleSyntheticGenerate = async () => {
        const req = {
            workspaceId: workspaceId,
            modelConfigName: activeConfigs[0].name,
            versionNumber: version?.versionNumber,
            systemPromptVersionNumber: workspace?.workspace?.currentSystemPromptVersionNumber,
        } as Partial<SyntheticGenerationRequest>;
        try {
            const response = await client.syntheticGeneration(req);
            console.log(response);

            // Update test results
            setTestResults((prevTestResults) => [
                ...prevTestResults,
                ...response.result,
            ]);

            // Update test cases
            setTestCases((prevTestCases) => {
                const updatedTestCases = [...prevTestCases];
                response.result.forEach((result) => {
                    const index = updatedTestCases.findIndex((tc) => tc.id === result.testCaseId);
                    if (index !== -1) {
                        updatedTestCases[index] = {
                            ...updatedTestCases[index],
                            hasBeenEvaluated: true,
                            // Add any other properties you want to update
                        };
                    }
                });
                return updatedTestCases;
            });

        } catch (error) {
            console.error("Error generating synthetic test cases:", error);
        }
    };

    const handleGenerateTestCase = async (numCases: number) => {
        const req: Partial<GenerateTestCaseRequest> = {
            versionNumber: version?.versionNumber,
            workspaceId: workspaceId,
            nTestCases: numCases,
        };
        if (seedPrompt && seedPrompt.length > 0) {
            req.seedPrompt = seedPrompt;
        }
        try {
            const response = await client.generateTestCase(req);
            if (!response.testCases) {
                return;
            }
            setTestCases([...testCases, ...response.testCases]);
        } catch (error) {
            console.error("Error generating test cases:", error);
        }
    };

    const handleDeleteTestCase = async (testCaseId: string | undefined) => {
        if (!testCaseId) {
            return;
        }
        try {
            await client.deleteTestCase({id: testCaseId} as DeleteTestCaseRequest);
            setTestCases(testCases.filter((tc: TestCaseWithoutMethods) => tc.id !== testCaseId));
        } catch (error) {
            console.error("Error deleting test case:", error);
        }
    };

    const renderVariableInput = (
        testCase: Pick<TestCase, "variableValues" | "id" | "hasBeenEvaluated">,
        variable: Variable,
    ) => {
        const value = testCase.variableValues?.[variable.name];

        switch (variable.type) {
            case VariableType.TEXT:
                return (
                    <Textarea
                        value={value?.value.value?.toString() || ""}
                        onChange={(e) =>
                            handleVariableValueChange(
                                testCase.id,
                                variable.name,
                                VariableValue.fromJson({textValue: e.target.value}),
                            )
                        }
                        className={"h-40 overflow-auto"}
                        disabled={testCase.hasBeenEvaluated}
                    />
                );
            case VariableType.IMAGE:
                return (
                    <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    handleVariableValueChange(
                                        testCase.id,
                                        variable.name,
                                        VariableValue.fromJson({
                                            imageValue: reader.result as string,
                                        }),
                                    );
                                };
                                reader.readAsDataURL(file);
                            }
                        }}
                    />
                );
            default:
                return null;
        }
    };

    const handleRating = (rating: number, testResultID: string) => {
        client.rateTestResult({testResultId: testResultID, rating: rating} as RateTestResultRequest).then(() => {
            console.log('Rating submitted');
        });
    };

    return (
        <div className="space-y-4 w-full flex-shrink-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        {variables.map((variable) => (
                            <TableHead key={variable.name}>
                                {variable.name}
                                {/*<Select*/}
                                {/*    value={variable.type.toString()}*/}
                                {/*    onValueChange={(value) => handleVariableTypeChange(variable.name, parseInt(value) as VariableType)}*/}
                                {/*>*/}
                                {/*    <SelectTrigger className="w-[100px]">*/}
                                {/*        <SelectValue placeholder="Type"/>*/}
                                {/*    </SelectTrigger>*/}
                                {/*    <SelectContent>*/}
                                {/*        <SelectItem value={VariableType.TEXT.toString()}>Text</SelectItem>*/}
                                {/*        <SelectItem value={VariableType.IMAGE.toString()}>Image</SelectItem>*/}
                                {/*    </SelectContent>*/}
                                {/*</Select>*/}
                            </TableHead>
                        ))}
                        {activeConfigs.map((config) => (
                            <TableHead key={config.id}>Output ({config.name})</TableHead>
                        ))}
                        <TableHead>Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {testCases.map((testCase, index) => (
                        <TableRow key={testCase.id}>
                            {variables.map((variable) => (
                                <TableCell key={variable.name}>
                                    {renderVariableInput(testCase, variable)}
                                </TableCell>
                            ))}
                            {activeConfigs.map((config) => (
                                <TableCell key={config.id}>
                                    {activeVersions.map((version) => {
                                        const matchingResult = testResults.find(
                                            (tr) =>
                                                tr.testCaseId === testCase.id &&
                                                tr.workspaceConfigId === config.id &&
                                                tr.promptVersionNumber === version.versionNumber,
                                        );

                                        return <EnhancedTableCell matchingResult={matchingResult}
                                                                  onRunTest={() => handleRunTest(testCase, version.versionNumber)}
                                                                  xmlMode={xmlMode}
                                                                  versionNumber={version.versionNumber}
                                                                  handleRating={handleRating}
                                                                  expanded={expandedRowNumber === index}
                                        />;

                                    })}
                                </TableCell>
                            ))}
                            <TableCell>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteTestCase(testCase?.id)}
                                >
                                    Delete
                                </Button>
                                <Button variant={"outline"} size={"sm"}
                                        onClick={() => handleExpandRow(index)}>
                                    Expand
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <div className="flex justify-between items-center mt-4">
                <div className="flex items-center space-x-2">
                    <span>Items per page:</span>
                    <Select value={itemsPerPage.toString()}
                            onValueChange={(value) => handleItemsPerPageChange(Number(value))}>
                        <SelectTrigger className="w-[70px]">
                            <SelectValue/>
                        </SelectTrigger>
                        <SelectContent>
                            {[5, 10, 20, 50, 100].map((num) => (
                                <SelectItem key={num} value={num.toString()}>{num}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                    >
                        Previous
                    </Button>
                    <span>{`Page ${currentPage} of ${totalPages}`}</span>
                    <Button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                    >
                        Next
                    </Button>
                </div>
            </div>

            <div className="flex space-x-2 justify-between">
                <div className={"space-x-2"}>
                    <Button onClick={handleAddRow}>+ Add Row</Button>
                    <Button onClick={() => handleGenerateTestCase(1)}>Generate Test Case</Button>
                    <Button onClick={() => handleGenerateTestCase(10)}>Generate 10 Test Cases</Button>
                    <Button onClick={handleSyntheticGenerate}>Synthetic Generate</Button>
                </div>
                <div className={"space-x-2"}>
                    <Button variant={"outline"} onClick={() => document.getElementById('yaml-import')?.click()}>
                        Import Test Cases
                    </Button>
                    <Button variant="outline" onClick={handleExportToYAML}>Export to YAML</Button>

                    <ModelConfigDialog
                        workspaceId={workspaceId}
                        onConfigsChange={setActiveConfigs}
                        configs={workspace?.workspace?.workspaceConfigs || []}
                    />
                </div>
            </div>
            <div>
                <Textarea value={seedPrompt} onChange={(e) => setSeedPrompt(e.target.value)}
                          placeholder="Test case generation seed prompt"/>
                <Input
                    type="file"
                    accept=".yaml,.yml"
                    onChange={handleImportYAML}
                    style={{ display: 'none' }}
                    id="yaml-import"
                />
            </div>
        </div>
    );
};

export default PromptTester;
