import ModelSettingsDialog from "@/components/ModelSettingsDialog.tsx";
import React, {useState} from "react";
import {useConnectClient} from "@/providers/ConnectProvider";
import {CreateWorkspaceRequest, CreateWorkspaceResponse, GeneratePromptRequest} from "@/lib/gen/eval/v1/eval_pb";
import {Textarea} from "@/components/ui/textarea";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert"
import {AlertCircle} from "lucide-react";
import {useNavigate} from "react-router-dom";

interface PromptGeneratorProps {
    modelConfigName: string | undefined;
}

const PromptGenerator: React.FC<PromptGeneratorProps> = ({modelConfigName}) => {
    const [prompt, setPrompt] = useState('');
    const [promptHistory, setPromptHistory] = useState<string[]>([]);
    const [numLines, setNumLines] = useState<number>(4);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const client = useConnectClient();
    const navigate = useNavigate();

    const handleSavePrompt = () => {
        const req: Partial<CreateWorkspaceRequest> = {
            content: prompt,
        };
        setError(null)
        setPending(true)
        client.createWorkspace(req).then((response: CreateWorkspaceResponse) => {
            console.log(response);
            navigate("/workspaces/" + response.workspace?.id);
        }).catch((error) => {
            setError(error.message)
        });
    };

    const handleGeneratePrompt = () => {
        if (!modelConfigName) {
            console.error("Model config name is required to generate prompt");
            return;
        }
        setPending(true)
        setError(null)
        const req: Partial<GeneratePromptRequest> = {
            prompt: prompt,
            modelConfigName: modelConfigName,
        };
        client.generatePrompt(req).then((response) => {
            console.log(response);
            // Assuming the response contains the generated prompt in a 'generatedPrompt' field
            if (response.generatedPrompt) {
                setPromptHistory([...promptHistory, prompt]);
                setPrompt(response.generatedPrompt);
                setNumLines(40);
            }
        }).catch((error) => {
            setError(error.message)
        }).finally(() => {
            setPending(false);
        });
    };

    const handleUndo = () => {
        if (promptHistory.length > 0) {
            const previousPrompt = promptHistory[promptHistory.length - 1];
            setPrompt(previousPrompt);
            setPromptHistory(promptHistory.slice(0, -1));
        }
    };

    return (
        <div className="p">
            <Textarea
                placeholder="Describe your task here..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full mb-4"
                rows={numLines}
                disabled={pending}
            />
            <div className="flex flex-row justify-between items-center mb-2">
                <div className={"space-x-2"}>
                    <Button onClick={handleGeneratePrompt} disabled={pending}>Generate Prompt</Button>
                    <Button onClick={handleUndo} disabled={promptHistory.length === 0}>Undo</Button>
                </div>
                <Button onClick={handleSavePrompt} disabled={pending}>Accept</Button>
            </div>
            {error && <Alert variant={"destructive"} className={"mt-2"}>
                <AlertCircle className="h-4 w-4"/>
                <AlertTitle>Error generating prompt</AlertTitle>
                <AlertDescription>
                    {error}
                </AlertDescription>
            </Alert>}
        </div>
    );
};

const NewWorkspace = () => {
    const [smallDefault, setSmallDefault] = useState<string>('');
    const [largeDefault, setLargeDefault] = useState<string>('');
    return (
        <div>
            <div className={"flex flex-row justify-between items-center"}>
                <h1 className={"text-xl"}>Create a new workspace</h1>
                <ModelSettingsDialog smallDefault={smallDefault} largeDefault={largeDefault}
                                     setSmallDefault={setSmallDefault} setLargeDefault={setLargeDefault}/>
            </div>
            <PromptGenerator modelConfigName={largeDefault}/>
        </div>
    );
}

export default NewWorkspace;