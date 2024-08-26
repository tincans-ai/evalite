import React, {useEffect, useState} from 'react';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Checkbox} from "@/components/ui/checkbox";
import {useConnectClient} from "@/providers/ConnectProvider";
import {Slider} from "@/components/ui/slider.tsx";
import {
    CreateWorkspaceConfigRequest,
    DeleteWorkspaceConfigRequest,
    MessageOptions, ModelConfig,
    SetWorkspaceConfigActiveRequest,
    WorkspaceConfig
} from "@/lib/gen/eval/v1/eval_pb.ts";

interface WorkspaceSettingsDialogProps {
    workspaceId: string;
    configs: WorkspaceConfig[] | [];
    onConfigsChange: (configs: WorkspaceConfig[]) => void;
}

const WorkspaceSettingsDialog: React.FC<WorkspaceSettingsDialogProps> = ({workspaceId, configs, onConfigsChange}) => {
    const [localConfigs, setLocalConfigs] = useState<Omit<WorkspaceConfig, | 'createdAt' | 'updatedAt'>[]>(configs);
    const [newConfig, setNewConfig] = useState<Omit<WorkspaceConfig, 'id' | 'createdAt' | 'updatedAt'>>({
        name: '',
        modelConfigName: '',
        messageOptions: {temperature: 0.3, maxTokens: 100} as MessageOptions,
    } as Omit<WorkspaceConfig, 'id' | 'createdAt' | 'updatedAt'>);
    const [modelConfigs, setModelConfigs] = useState<Record<string, ModelConfig>>({});
    const [activeConfigs, setActiveConfigs] = useState<string[]>(configs.map(c => c.id));

    const client = useConnectClient();

    useEffect(() => {
        const fetchModelConfigs = async () => {
            const response = await client.listModelConfigs({});
            setModelConfigs(response.modelConfigs);
        };
        fetchModelConfigs();
    }, []);

    useEffect(() => {
        setLocalConfigs(configs);
        setActiveConfigs(configs.filter(c => c.active).map(c => c.id));
    }, [configs])

    const handleAddConfig = async () => {
        const createRequest: Partial<CreateWorkspaceConfigRequest> = {
            workspaceId: workspaceId,
            name: newConfig.name,
            modelConfigName: newConfig.modelConfigName,
            messageOptions: newConfig.messageOptions,
        };

        try {
            const response = await client.createWorkspaceConfig(createRequest);
            const createdConfig = response.workspaceConfig;
            if (!createdConfig) {
                throw new Error("Failed to create workspace config");
            }
            setLocalConfigs([...localConfigs, createdConfig]);
            setActiveConfigs([...activeConfigs, createdConfig.id]);
            onConfigsChange([...localConfigs, createdConfig]);
            setNewConfig({
                name: '',
                modelConfigName: '',
                messageOptions: {temperature: 0.3, maxTokens: 100} as MessageOptions
            } as Omit<WorkspaceConfig, 'id' | 'createdAt' | 'updatedAt'>);
        } catch (error) {
            console.error("Error creating workspace config:", error);
            // TODO: Handle error (e.g., show error message to user)
        }
    };

    const handleConfigSelection = async (configId: string) => {
        const req: Partial<SetWorkspaceConfigActiveRequest> = {
            workspaceId: workspaceId,
            workspaceConfigId: configId,
            active: !activeConfigs.includes(configId),
        };
        await client.setWorkspaceConfigActive(req);

        setActiveConfigs(prev =>
            prev.includes(configId)
                ? prev.filter(id => id !== configId)
                : [...prev, configId]
        );
        onConfigsChange(localConfigs.filter(config => activeConfigs.includes(config.id)));
    };

    const handleRemoveConfig = async (configId: string) => {
        const deleteRequest: Partial<DeleteWorkspaceConfigRequest> = {
            workspaceId: workspaceId,
            workspaceConfigId: configId,
        };

        try {
            await client.deleteWorkspaceConfig(deleteRequest);
            const updatedConfigs = localConfigs.filter(config => config.id !== configId);
            setLocalConfigs(updatedConfigs);
            setActiveConfigs(activeConfigs.filter(id => id !== configId));
            onConfigsChange(updatedConfigs);
        } catch (error) {
            console.error("Error deleting workspace config:", error);
            // TODO: Handle error (e.g., show error message to user)
        }
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">Model Configs</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                    <DialogTitle>Model Configs</DialogTitle>
                    <DialogDescription>
                        Create and manage model configurations for this workspace. Multiple configurations can be active
                        simultaneously.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="config-name" className="text-right">Name:</label>
                        <Input
                            id="config-name"
                            placeholder={"config name, e.g. 'llama-70-temp-0.3'"}
                            value={newConfig.name}
                            onChange={(e) => setNewConfig({...newConfig, name: e.target.value})}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="model-config" className="text-right">Model Config:</label>
                        <Select
                            value={newConfig.modelConfigName}
                            onValueChange={(value) => setNewConfig({...newConfig, modelConfigName: value})}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select model"/>
                            </SelectTrigger>
                            <SelectContent>
                                {Object.keys(modelConfigs).map(key => (
                                    <SelectItem key={key} value={key}>
                                        {key}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="temperature" className="text-right">Temperature:</label>
                        <div className="col-span-3 flex items-center gap-4">
                            <Slider
                                id="temperature"
                                value={[newConfig.messageOptions?.temperature || 0.3]}
                                max={2.0}
                                step={0.1}
                                onValueChange={(value) => setNewConfig({
                                    ...newConfig,
                                    messageOptions: {...newConfig.messageOptions, temperature: value[0]}
                                } as Omit<WorkspaceConfig, 'id' | 'createdAt' | 'updatedAt'>)}
                            />
                            <p className="text-muted-foreground">{newConfig.messageOptions?.temperature?.toFixed(1)}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="max-tokens" className="text-right">Max Tokens:</label>
                        <div className="col-span-3 flex items-center gap-4">
                            <Slider
                                id="max-tokens"
                                value={[newConfig.messageOptions?.maxTokens || 100]}
                                max={3200}
                                min={100}
                                step={100}
                                onValueChange={(value) => setNewConfig({
                                    ...newConfig,
                                    messageOptions: {...newConfig.messageOptions, maxTokens: value[0]}
                                } as Omit<WorkspaceConfig, 'id' | 'createdAt' | 'updatedAt'>)}
                            />
                            <p className="text-muted-foreground">{newConfig.messageOptions?.maxTokens?.toFixed(0)}</p>
                        </div>
                    </div>
                    <Button onClick={handleAddConfig}>Add Config</Button>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">Active</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Model Config</TableHead>
                            <TableHead>Temperature</TableHead>
                            <TableHead>Max Tokens</TableHead>
                            <TableHead>Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {localConfigs.map((config) => (
                            <TableRow key={config.id}>
                                <TableCell>
                                    <Checkbox
                                        checked={activeConfigs.includes(config.id)}
                                        onCheckedChange={() => handleConfigSelection(config.id)}
                                    />
                                </TableCell>
                                <TableCell>{config.name}</TableCell>
                                <TableCell>{config.modelConfigName}</TableCell>
                                <TableCell>{config.messageOptions?.temperature?.toFixed(1)}</TableCell>
                                <TableCell>{config.messageOptions?.maxTokens}</TableCell>
                                <TableCell>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => handleRemoveConfig(config.id)}
                                    >
                                        Remove
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <DialogClose>
                    <Button variant="outline">Close</Button>
                </DialogClose>
            </DialogContent>
        </Dialog>
    );
};

export default WorkspaceSettingsDialog;