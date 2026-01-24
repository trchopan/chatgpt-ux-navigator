// OpenAI-ish "response" object shape (minimal)
export type ResponseObject = {
    id: string;
    object: 'response';
    created_at: number;
    completed_at: number | null;
    status: 'in_progress' | 'completed' | 'cancelled' | 'error';
    model: string | null;

    // We keep this as a convenience for debugging (not OpenAI exact)
    input: any;

    output: Array<any>;
    output_text: string;

    usage: any | null;
    meta?: any;
    metadata?: any;
};
