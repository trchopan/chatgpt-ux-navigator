export type WsData = {id: string};

export type ChatGPTStreamMeta = {
    url: string;
    at: number;
    contentType: string;
};

export type ChatGPTMetadata = {
    conduit_prewarmed: boolean;
    plan_type: string;
    user_agent: string;
    service: string | null;
    tool_name: string | null;
    tool_invoked: boolean;
    fast_convo: boolean;
    warmup_state: string;
    is_first_turn: boolean;
    cluster_region: string;
    model_slug: string;
    region: string | null;
    is_multimodal: boolean;
    did_auto_switch_to_reasoning: boolean;
    auto_switcher_race_winner: string | null;
    is_autoswitcher_enabled: boolean;
    is_search: boolean | null;
    did_prompt_contain_image: boolean;
    search_tool_call_count: number | null;
    search_tool_query_types: string[] | null;
    message_id: string;
    request_id: string;
    turn_exchange_id: string;
    turn_trace_id: string;
    resume_with_websockets: boolean;
    streaming_async_status: boolean;
    temporal_conversation_turn: boolean;
};

export type ChatGPTServerSteMetadata = {
    type: 'server_ste_metadata';
    metadata: ChatGPTMetadata;
    conversation_id: string;
};

export type ChatGPTMessageStreamComplete = {
    type: 'message_stream_complete';
    conversation_id: string;
};

export type ChatGPTConversationDetailMetadata = {
    type: 'conversation_detail_metadata';
    banner_info: any | null;
    blocked_features: string[];
    model_limits: any[];
    limits_progress: any | null;
    default_model_slug: string;
    conversation_id: string;
};

export type ChatGPTEventJson =
    | ChatGPTServerSteMetadata
    | ChatGPTMessageStreamComplete
    | ChatGPTConversationDetailMetadata;

export type WsPayloadSse = {
    meta: ChatGPTStreamMeta;
    event: string | null;
    raw: string | null;
    json: ChatGPTEventJson;
};

export type WsPayloadDoneOrClosed = {
    meta: ChatGPTStreamMeta;
    event?: null;
    raw?: null;
    json?: null;
};

export type WsPayload = WsPayloadSse | WsPayloadDoneOrClosed;

export type IncomingWebSocketMessage = {
    type: 'sse' | 'done' | 'closed' | 'error' | string;
    payload: WsPayload;
};
