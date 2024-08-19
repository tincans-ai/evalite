import {useEffect, useState} from "react";
import {useParams} from "react-router-dom";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";
import PromptGenerator from "@/pages/PromptGenerator.tsx";
import PromptTester from "@/pages/PromptTester.tsx";
import ModelSettingsDialog from "@/components/ModelSettingsDialog.tsx";
import {GetWorkspaceRequest, GetWorkspaceResponse, Workspace_Prompt} from "@/lib/gen/eval/v1/eval_pb.ts";
import {useConnectClient} from "@/providers/ConnectProvider.tsx";
import {Badge} from "@/components/ui/badge.tsx";
import VersionSelectDialog from "@/components/VersionSelectDialog"; // Import the new component

const WorkspacePage = () => {
    const {workspaceId} = useParams<{ workspaceId: string }>();
    const [workspace, setWorkspace] = useState<GetWorkspaceResponse | undefined>(undefined);
    const [smallDefault, setSmallDefault] = useState<string>('');
    const [largeDefault, setLargeDefault] = useState<string>('');
    const [currentVersion, setCurrentVersion] = useState<Workspace_Prompt | undefined>(undefined);
    const [activeVersions, setActiveVersions] = useState<Workspace_Prompt[]>([]);
    const client = useConnectClient();

    useEffect(() => {
        const req: Partial<GetWorkspaceRequest> = ({
            id: workspaceId
        });
        client.getWorkspace(req).then((res: GetWorkspaceResponse) => {
            setWorkspace(res);
            if (!res.workspace) {
                return;
            }
            console.log(res);
            const versionNumber = res.workspace.currentPromptVersionNumber || res.workspace.prompts?.length - 1 || 0;
            setCurrentVersion(res.workspace?.prompts.find((version) => version.versionNumber === versionNumber));
            const activeVersions = res.workspace?.prompts?.filter((version) => res.workspace?.activeVersionNumbers.includes(version.versionNumber)) || [];
            setActiveVersions(activeVersions);
        });
    }, [workspaceId])

    const handleVersionSelect = (version: Workspace_Prompt) => {
        setCurrentVersion(version);
    };

    if (!workspaceId) {
        return <div>Error: Workspace ID not provided</div>;
    }

    return (
        <div className="p-4">
            <div className={"flex justify-between items-center"}>
                <div className={"flex flex-row items-center mb-4 space-x-2"}>
                    <h1 className="text-2xl font-bold">{workspace ? workspace.workspace?.name : "Untitled"}</h1>
                    <Badge>v{currentVersion?.versionNumber}</Badge>
                </div>
                <div className="flex space-x-2">
                    <VersionSelectDialog
                        versions={workspace?.workspace?.prompts || []}
                        currentVersion={currentVersion}
                        onVersionSelect={handleVersionSelect}
                        activeVersions={activeVersions}
                        onSetActiveVersions={setActiveVersions}
                    />
                    <ModelSettingsDialog
                        smallDefault={smallDefault}
                        largeDefault={largeDefault}
                        setSmallDefault={setSmallDefault}
                        setLargeDefault={setLargeDefault}
                    />
                </div>
            </div>
            <Tabs defaultValue="generator">
                <TabsList>
                    <TabsTrigger value="generator">Prompt Editor</TabsTrigger>
                    <TabsTrigger value="tester">Prompt Tester</TabsTrigger>
                </TabsList>
                <TabsContent value="generator">
                    <PromptGenerator workspaceId={workspaceId} workspace={workspace} version={currentVersion}/>
                </TabsContent>
                <TabsContent value="tester">
                    <PromptTester workspaceId={workspaceId} workspace={workspace} version={currentVersion}
                                  activeVersions={activeVersions}/>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default WorkspacePage;