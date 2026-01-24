export type ResponseObject = {
    id: string;
    object: 'response';
    created_at: number;
    completed_at: number | null;
    status: 'in_progress' | 'completed' | 'cancelled' | 'error';
    model: string | null;

    output: any[];
    output_text: string;

    usage: any | null;

    tool_choice?: string | object;
    tools?: any[];

    // Not strictly OpenAI, but useful in your local bridge
    input: any;

    meta?: any;
    metadata?: any;
};
