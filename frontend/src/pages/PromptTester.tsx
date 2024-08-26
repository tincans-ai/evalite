import React, {useEffect, useState} from "react";
import {
    DeleteTestCaseRequest,
    EvaluationRequest,
    GenerateTestCaseRequest,
    GetWorkspaceResponse,
    ListTestCasesRequest,
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
import WorkspaceSettingsDialog from "@/components/WorkspaceSettingsDialog";
import {Badge} from "@/components/ui/badge.tsx";
import XMLViewer from 'react-xml-viewer'
import {Copy} from "lucide-react";

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

const CopyButton = ({ content } : { content: string}) => {
    const handleCopy = () => {
        navigator.clipboard.writeText(content).then(() => {
            // You can add a toast notification here if you want
            console.log('Copied to clipboard');
        });
    };

    return (
        <Button
            variant="outline"
            size="icon"
            className="absolute top-2 right-2"
            onClick={handleCopy}
        >
            <Copy className="h-4 w-4" />
        </Button>
    );
};

const EnhancedTableCell = ({ matchingResult, xmlMode, versionNumber, onRunTest }) => {
    return (
        <TableCell className="relative">
            {matchingResult ? (
                <div>
                    <CopyButton content={matchingResult.response} />
                    <pre className="max-h-40 overflow-auto max-w-md text-wrap">
            {xmlMode ? (
                <XMLViewer xml={matchingResult.response} collapsible />
            ) : (
                <div>{matchingResult.response}</div>
            )}
          </pre>
                    <Badge variant="outline" className="mt-2">
                        v{matchingResult.promptVersionNumber}
                    </Badge>
                </div>
            ) : (
                <div className="space-x-2">
                    <Badge variant="outline" className="mt-2">
                        v{versionNumber}
                    </Badge>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRunTest}
                    >
                        Run
                    </Button>
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

    const handleGenerateTestCase = async () => {
        const req: Partial<GenerateTestCaseRequest> = {
            versionNumber: version?.versionNumber,
            workspaceId: workspaceId,
        };
        try {
            const response = await client.generateTestCase(req);
            if (!response.testCase) {
                return;
            }
            setTestCases([...testCases, response.testCase]);
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
                    {testCases.map((testCase) => (
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

                                        return <EnhancedTableCell matchingResult={matchingResult} onRunTest={() => handleRunTest(testCase, version.versionNumber)} xmlMode={xmlMode} versionNumber={version.versionNumber} />;

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
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <div className="flex space-x-2">
                <Button onClick={handleAddRow}>+ Add Row</Button>
                <Button onClick={handleGenerateTestCase}>Generate Test Case</Button>
                <Button variant="outline">Import Test Cases</Button>
                <Button variant="outline">Export to CSV</Button>
                <WorkspaceSettingsDialog
                    workspaceId={workspaceId}
                    onConfigsChange={setActiveConfigs}
                    configs={workspace?.workspace?.workspaceConfigs || []}
                />
            </div>
        </div>
    );
};

export default PromptTester;
