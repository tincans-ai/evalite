import React, {useEffect, useMemo, useState} from 'react';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog.tsx";
import {Input} from "@/components/ui/input.tsx";
import {Button} from "@/components/ui/button.tsx";
import {useConnectClient} from "@/providers/ConnectProvider.tsx";
import {ModelConfig} from "@/lib/gen/eval/v1/eval_pb.ts";
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown,  } from "lucide-react"

type ModelConfigsTableProps = {
    modelConfigs: Record<string, ModelConfig>
}

type columnsForTable = {
    key: string,
    providerType: string,
    // modelName: string,
}

export function ModelConfigsTable({ modelConfigs }: ModelConfigsTableProps) {
    const [sorting, setSorting] = useState<SortingState>([])
    // const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
    // const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

    const columns = useMemo<ColumnDef<columnsForTable>[]>(() => [
        {
            accessorKey: "key",
            header: "Key",
            cell: ({ row }) => <pre>{row.getValue("key")}</pre>,
        },
        {
            accessorKey: "providerType",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        Provider
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => <div>{row.getValue("providerType")}</div>,
        },
        // {
        //     accessorKey: "modelName",
        //     header: "Model",
        //     cell: ({ row }) => <pre>{row.getValue("modelName")}</pre>,
        // },
    ], [])

    const data = useMemo(() =>
            Object.entries(modelConfigs).map(([key, config]) => ({
                key,
                ...config,
            })),
        [modelConfigs]
    )

    const table = useReactTable({
        data,
        columns,
        onSortingChange: setSorting,
        // onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        // onColumnVisibilityChange: setColumnVisibility,
        state: {
            sorting,
            // columnFilters,
            // columnVisibility,
        },
    })

    return (
        <div className="w-full">
            <div className="flex items-center py-4">
                <Input
                    placeholder="Filter providers..."
                    value={(table.getColumn("providerType")?.getFilterValue() as string) ?? ""}
                    onChange={(event) =>
                        table.getColumn("providerType")?.setFilterValue(event.target.value)
                    }
                    className="w-full"
                />
                {/*<DropdownMenu>*/}
                {/*    <DropdownMenuTrigger asChild>*/}
                {/*        <Button variant="outline" className="ml-2">*/}
                {/*            Columns <ChevronDown className="ml-2 h-4 w-4" />*/}
                {/*        </Button>*/}
                {/*    </DropdownMenuTrigger>*/}
                {/*    <DropdownMenuContent align="end">*/}
                {/*        {table*/}
                {/*            .getAllColumns()*/}
                {/*            .filter((column) => column.getCanHide())*/}
                {/*            .map((column) => {*/}
                {/*                return (*/}
                {/*                    <DropdownMenuCheckboxItem*/}
                {/*                        key={column.id}*/}
                {/*                        className="capitalize"*/}
                {/*                        checked={column.getIsVisible()}*/}
                {/*                        onCheckedChange={(value) =>*/}
                {/*                            column.toggleVisibility(!!value)*/}
                {/*                        }*/}
                {/*                    >*/}
                {/*                        {column.id}*/}
                {/*                    </DropdownMenuCheckboxItem>*/}
                {/*                )*/}
                {/*            })}*/}
                {/*    </DropdownMenuContent>*/}
                {/*</DropdownMenu>*/}
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={row.id}>
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
                <div className="flex-1 text-sm text-muted-foreground">
                    {table.getFilteredRowModel().rows.length} row(s) total
                </div>
                <div className="space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    )
}


interface ModelSettingsDialogProps {
    smallDefault: string;
    setSmallDefault: React.Dispatch<React.SetStateAction<string>>;
    largeDefault: string;
    setLargeDefault: React.Dispatch<React.SetStateAction<string>>;
}

const ModelSettingsDialog: React.FC<ModelSettingsDialogProps> = ({
                                                                     smallDefault,
                                                                     setSmallDefault,
                                                                     largeDefault,
                                                                     setLargeDefault
                                                                 }) => {
    const [modelConfigs, setModelConfigs] = useState<Record<string, ModelConfig>>({});

    const client = useConnectClient();

    useEffect(() => {
        // Fetch model configs and defaults
        const fetchData = async () => {
            client.listModelConfigs({}).then((response) => {
                setModelConfigs(response.modelConfigs);
            });

            client.getDefaultLargeModelConfig({}).then((response) => {
                setLargeDefault(response.modelConfigName);
            });
            client.getDefaultSmallModelConfig({}).then((response) => {
                setSmallDefault(response.modelConfigName);
            });
        };
        fetchData();
    }, []);

    const handleSetDefault = (size: 'small' | 'large', modelName: string) => {
        if (size === 'small') {
            setSmallDefault(modelName);
        } else {
            setLargeDefault(modelName);
        }
        // TODO: make an API call to update the default
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">Model Settings</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Model Settings</DialogTitle>
                    <DialogDescription>
                        View available models and set defaults for small and large models.
                    </DialogDescription>
                </DialogHeader>
                <DialogClose>
                    <Button variant="ghost">Close</Button>
                </DialogClose>
                <DialogContent>
                    <div>
                        <div className="py-4">
                            <h3 className="mb-2 font-medium">Available Models</h3>
                            <ModelConfigsTable modelConfigs={modelConfigs}/>
                        </div>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="small-default" className="text-right">
                                    Small Default:
                                </label>
                                <Select
                                    value={smallDefault}
                                    onValueChange={(value) => handleSetDefault('small', value)}
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
                                <label htmlFor="large-default" className="text-right">
                                    Large Default:
                                </label>
                                <Select
                                    value={largeDefault}
                                    onValueChange={(value) => handleSetDefault('large', value)}
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
                        </div>
                    </div>
                </DialogContent>
            </DialogContent>
        </Dialog>
    );
};

export default ModelSettingsDialog;