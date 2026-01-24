// OpenAI-ish "response" object shape (minimal)
export type ResponseObject = {
    id: string;
    object: 'response';
    created: number;
    status: 'in_progress' | 'completed' | 'cancelled' | 'error';
    model: string | null;
    input: string;
    output: Array<{
        id: string;
        object: 'output_text';
        content: any[];
    }>;
    output_text: string;
    meta?: any;
};
