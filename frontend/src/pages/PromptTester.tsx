import React, {useEffect, useState} from "react";
import {
    DeleteTestCaseRequest,
    EvaluationRequest,
    GenerateTestCaseRequest,
    GetWorkspaceResponse,
    ListTestCasesRequest,
    RateTestResultRequest,
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
    "toJSON" | "toProtobuf" | "clone"
>;
type ListTestCasesRequestWithoutMethods = Omit<
    ListTestCasesRequest,
    "toJSON" | "toProtobuf" | "clone"
>;

type TestResultWithoutMethods = Omit<TestResult, "toJSON" | "toProtobuf" | "clone">;

const EnhancedTableCell = ({matchingResult, xmlMode, versionNumber, onRunTest, handleRating, expanded}) => {
    const handleCopy = () => {
        navigator.clipboard.writeText(matchingResult?.content).then(() => {
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
        <div className={cn( expanded ? "h-[960px]" : "h-[120px]", "overflow-auto max-w-md text-wrap text-xs items-start",)}>
            {xmlMode ? (
                <XMLViewer xml={content} collapsible/>
            ) : (
                <pre className={"flex max-w-md text-wrap text-xs items-start"}>
                    {content}
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
    const client = useConnectClient();

    useEffect(() => {
        const fetchTestCases = async () => {
            const req: ListTestCasesRequestWithoutMethods = {
                workspaceId: workspaceId,
                page: 1,
                pageSize: 10,
            };
            try {
                const response = await client.listTestCases(req);
                setTestCases(response.testCases);
                setTestResults(response.testResults);
                console.log(response);
            } catch (error) {
                console.error("Error fetching test cases:", error);
            }
        };

        fetchTestCases();
    }, [workspaceId, client]);

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
        const newTestCase: TestCaseWithoutMethods = {
            id: `new-${Date.now()}`,
            variableValues: {},
            workspaceId: workspaceId,
            hasBeenEvaluated: false,
        };
        setTestCases([...testCases, newTestCase]);
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

    const handleGenerateTestCase = async (numCases: number) => {
        const req: Partial<GenerateTestCaseRequest> = {
            versionNumber: version?.versionNumber,
            workspaceId: workspaceId,
            nTestCases: numCases,
        };
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

            <div className="flex space-x-2">
                <Button onClick={handleAddRow}>+ Add Row</Button>
                <Button onClick={() => handleGenerateTestCase(1)}>Generate Test Case</Button>
                <Button onClick={() => handleGenerateTestCase(2)}>Generate Test Cases</Button>
                <Button variant="outline">Import Test Cases</Button>
                <Button variant="outline">Export to CSV</Button>
                <ModelConfigDialog
                    workspaceId={workspaceId}
                    onConfigsChange={setActiveConfigs}
                    configs={workspace?.workspace?.workspaceConfigs || []}
                />
            </div>
        </div>
    );
};

export default PromptTester;
