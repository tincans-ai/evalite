import React, {useEffect, useState} from "react";
import {useConnectClient} from "@/providers/ConnectProvider";
import {GetWorkspaceResponse, Workspace_Prompt, UpdateWorkspaceRequest} from "@/lib/gen/eval/v1/eval_pb";
import {Textarea} from "@/components/ui/textarea";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert"
import {AlertCircle} from "lucide-react";
import {useNavigate} from "react-router-dom";

interface PromptGeneratorProps {
    workspaceId: string;
    workspace: GetWorkspaceResponse | undefined;
    version: Workspace_Prompt | undefined;
}

const PromptGenerator: React.FC<PromptGeneratorProps> = ({workspaceId, version}) => {
    const [prompt, setPrompt] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const client = useConnectClient();
    const navigate = useNavigate();

    useEffect(() => {
        setPrompt(version?.content || '');
    }, [version]);


    const handleSavePrompt = () => {
        const req: Partial<UpdateWorkspaceRequest> = {
            workspaceId: workspaceId,
            newContent: prompt,
        };
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
        <div className="p">
            <Textarea
                placeholder="Describe your task here..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full mb-4 font-serif"
                rows={40}
                disabled={pending}
            />
            <div className="flex flex-row justify-between items-center mb-2">
                <div className={"space-x-2"}>
                </div>
                <Button onClick={handleSavePrompt} disabled={pending}>Save Prompt</Button>
            </div>
            {error && <Alert variant="destructive" className={"mt-2"}>
                <AlertCircle className="h-4 w-4"/>
                <AlertTitle>Error generating prompt</AlertTitle>
                <AlertDescription>
                    {error}
                </AlertDescription>
            </Alert>}
        </div>
    );
};

export default PromptGenerator;