import React from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Workspace_Prompt } from "@/lib/gen/eval/v1/eval_pb";

interface VersionSelectDialogProps {
    versions: Workspace_Prompt[];
    currentVersion: Workspace_Prompt | undefined;
    activeVersions: Workspace_Prompt[];
    onVersionSelect: (version: Workspace_Prompt) => void;
    onSetActiveVersions: (versions: Workspace_Prompt[]) => void;
}

const VersionSelectDialog: React.FC<VersionSelectDialogProps> = ({
                                                                     versions,
                                                                     currentVersion,
                                                                     activeVersions,
                                                                     onVersionSelect,
                                                                     onSetActiveVersions,
                                                                 }) => {
    const [selectedVersion, setSelectedVersion] = React.useState<Workspace_Prompt | undefined>(currentVersion);
    const [selectedActiveVersions, setSelectedActiveVersions] = React.useState<Workspace_Prompt[]>(activeVersions);

    const handleVersionChange = (value: string) => {
        const version = versions.find(v => v.versionNumber.toString() === value);
        setSelectedVersion(version);
    };

    const handleActiveVersionChange = (value: string) => {
        const version = versions.find(v => v.versionNumber.toString() === value);
        if (version) {
            setSelectedActiveVersions(prevVersions =>
                prevVersions.some(v => v.versionNumber === version.versionNumber)
                    ? prevVersions.filter(v => v.versionNumber !== version.versionNumber)
                    : [...prevVersions, version]
            );
        }
    };

    const handleConfirm = () => {
        if (selectedVersion) {
            onVersionSelect(selectedVersion);
        }
        onSetActiveVersions(selectedActiveVersions);
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">Select Version</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Select Prompt Version</DialogTitle>
                    <DialogDescription>
                        Choose a version of the prompt to work with.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Select onValueChange={handleVersionChange} defaultValue={currentVersion?.versionNumber.toString()}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a version" />
                        </SelectTrigger>
                        <SelectContent>
                            {versions.map((version) => (
                                <SelectItem key={version.versionNumber} value={version.versionNumber.toString()}>
                                    Version {version.versionNumber}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700">Active Versions (for comparison)</label>
                        <div className="mt-2">
                            {versions.map((version) => (
                                <div key={version.versionNumber} className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedActiveVersions.some(v => v.versionNumber === version.versionNumber)}
                                        onChange={() => handleActiveVersionChange(version.versionNumber.toString())}
                                        className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                                    />
                                    <label className="ml-3 block text-sm text-gray-900">
                                        Version {version.versionNumber}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button onClick={handleConfirm}>Confirm</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default VersionSelectDialog;
