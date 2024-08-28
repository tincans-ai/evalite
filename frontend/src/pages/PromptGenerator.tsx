import React, {useEffect, useState} from "react";
import {useConnectClient} from "@/providers/ConnectProvider";
import {
    GetWorkspaceResponse,
    Workspace_Prompt,
    UpdateWorkspaceRequest,
    Workspace_SystemPrompt
} from "@/lib/gen/eval/v1/eval_pb";
import {Textarea} from "@/components/ui/textarea";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert"
import {AlertCircle} from "lucide-react";
import {useNavigate} from "react-router-dom";

interface PromptGeneratorProps {
    workspaceId: string;
    workspace: GetWorkspaceResponse | undefined;
    version: Workspace_Prompt | undefined;
    systemPrompt: Workspace_SystemPrompt| undefined;
}

const PromptGenerator: React.FC<PromptGeneratorProps> = ({workspaceId, version, systemPrompt}) => {
    const [prompt, setPrompt] = useState('');
    const [systemPromptValue, setSystemPromptValue] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const client = useConnectClient();
    const navigate = useNavigate();

    useEffect(() => {
        setPrompt(version?.content || '');
        setSystemPromptValue(systemPrompt?.content || '');
    }, [version]);


    const handleSavePrompt = () => {
        const req: Partial<UpdateWorkspaceRequest> = {
            workspaceId: workspaceId,
            newContent: prompt,
            newSystemPrompt: systemPromptValue,
        };
        console.log(req);
        setPending(true);
        setError(null)
        client.updateWorkspace(req).then(() => {
            setPending(false);
            // refresh the workspace
            navigate(0);
        }).catch((error) => {
            setError(error.message)
        });
    };

    return (
        <div>
            <Textarea
                placeholder="Optional system prompt..."
                value={systemPromptValue}
                onChange={(e) => setSystemPromptValue(e.target.value)}
                className="w-full mb-4 font-serif"
                rows={20}
                disabled={pending}
            />
            <Textarea
                placeholder="Describe your task here..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full mb-4 font-serif"
                rows={20}
                disabled={pending}
            />
            <div className="flex flex-row justify-between items-center mb-2">
                <div className={"space-x-2"}>
                </div>
                <Button onClick={handleSavePrompt} disabled={pending}>Save Prompt</Button>
            </div>
            {error && <Alert variant="destructive" className={"mt-2"}>
                <AlertCircle className="h-4 w-4"/>
                <AlertTitle>Error saving prompt</AlertTitle>
                <AlertDescription>
                    {error}
                </AlertDescription>
            </Alert>}
        </div>
    );
};

export default PromptGenerator;