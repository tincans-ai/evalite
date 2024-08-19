import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {useConnectClient} from "@/providers/ConnectProvider.tsx";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table"
import {ListWorkspacesRequest, Workspace} from '@/lib/gen/eval/v1/eval_pb';
import {Button} from "@/components/ui/button.tsx";


// Workspace List Page
const WorkspaceList = () => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const client = useConnectClient();

    useEffect(() => {
        const fetchWorkspaces = async () => {
            const req: Partial<ListWorkspacesRequest> = {
                page: 1,
                pageSize: 10, // Adjust as needed
            };
            try {
                const response = await client.listWorkspaces(req);
                setWorkspaces(response.workspaces);
            } catch (error) {
                console.error("Error fetching workspaces:", error);
            }
        };

        fetchWorkspaces();
    }, [client]);

    return (
        <div className="p-4">
            <div className={"flex flex-row justify-between items-center"}>
                <h1 className="text-2xl font-bold mb-4">Workspaces</h1>
                <Link to="/workspaces/new">
                    <Button>Create Workspace</Button>
                </Link>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Last Updated</TableHead>
                        <TableHead>Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {workspaces.map((workspace) => (
                        <TableRow key={workspace.id}>
                            <TableCell>{workspace.name}</TableCell>
                            <TableCell>
                                {(() => {
                                    const date = new Date(workspace.updatedAt?.toDate() || 0);
                                    return `${date.toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}, ${date.toLocaleTimeString(undefined, {
                                        hour: 'numeric',
                                        minute: 'numeric'
                                    })}`;
                                })()}
                            </TableCell>
                            <TableCell>
                                <Link to={`/workspaces/${workspace.id}`}>
                                    <Button variant="outline" size="sm">Open</Button>
                                </Link>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

export default WorkspaceList;