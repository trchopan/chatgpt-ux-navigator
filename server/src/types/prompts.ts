export type ThreadMessage = {
    role: 'user' | 'assistant';
    content: string;
    hash: string;
};

export type TreeNode = {
    name: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
};
