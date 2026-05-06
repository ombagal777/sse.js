import { SSE } from "./sse";

// =============================================================================
// Mock Setup
// =============================================================================

function createMockXHR() {
    const eventHandlers = {};

    const mockXHR = {
        open: jest.fn(),
        send: jest.fn(),
        abort: jest.fn(),
        setRequestHeader: jest.fn(),
        getAllResponseHeaders: jest.fn(
            () => "content-type: text/event-stream\r\n"
        ),
        responseText: "",
        status: 200,
        readyState: 0,
        HEADERS_RECEIVED: 2,
        DONE: 4,
        addEventListener: jest.fn((event, handler) => {
            eventHandlers[event] = handler;
        }),
        trigger: (eventName, eventObj) => {
            if (eventHandlers[eventName]) {
                eventHandlers[eventName](eventObj);
            }
        },
    };

    return mockXHR;
}

beforeEach(() => {
    global.XMLHttpRequest = jest.fn(createMockXHR);
    global.XMLHttpRequest.HEADERS_RECEIVED = 2;
    global.XMLHttpRequest.DONE = 4;
});

describe("SSE Auto-Reconnect Backoff", () => {
    const errorEvent = {
        currentTarget: {
            status: 500,
            response: "error",
        },
    };

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("should use fixed reconnect delay by default", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1500,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            1500
        );
    });

    it("should cap fixed reconnect delay at maxReconnectDelay", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 5000,
            maxReconnectDelay: 2000,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            2000
        );
    });

    it("should fall back to fixed delay for unsupported strategies", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1200,
            reconnectDelayStrategy: "unsupported",
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            1200
        );
    });

    it("should increase reconnect delay with exponential strategy and cap it", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "exponential",
            maxReconnectDelay: 2500,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);
        expect(setTimeoutSpy).toHaveBeenNthCalledWith(
            1,
            expect.any(Function),
            1000
        );

        jest.runOnlyPendingTimers();
        sse.xhr.trigger("error", errorEvent);
        expect(setTimeoutSpy).toHaveBeenNthCalledWith(
            2,
            expect.any(Function),
            2000
        );

        jest.runOnlyPendingTimers();
        sse.xhr.trigger("error", errorEvent);
        expect(setTimeoutSpy).toHaveBeenNthCalledWith(
            3,
            expect.any(Function),
            2500
        );
    });

    it("should reset backoff delay after a successful reconnect", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "exponential",
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);
        jest.runOnlyPendingTimers();

        sse.xhr.trigger("error", errorEvent);
        jest.runOnlyPendingTimers();

        sse.xhr.responseText = "data: ok\n\n";
        sse.xhr.trigger("progress", {});
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenNthCalledWith(
            3,
            expect.any(Function),
            1000
        );
    });

    it("should add jitter to reconnect delay deterministically", () => {
        jest.spyOn(Math, "random").mockReturnValue(0.25);
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "jitter",
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            1250
        );
    });

    it("should honor server retry minimum over delay caps", () => {
        jest.spyOn(Math, "random").mockReturnValue(0);
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "jitter",
            maxReconnectDelay: 2000,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.responseText = "retry: 5000\n\n";
        sse.xhr.trigger("progress", {});
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            5000
        );
    });

    it("should use custom reconnect delay strategy with correct context", () => {
        const customFn = jest.fn((ctx) => ctx.baseDelay * 3);
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "custom",
            customReconnectDelay: customFn,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            3000
        );
        expect(customFn).toHaveBeenCalledWith({
            retryCount: 0,
            baseDelay: 1000,
            lastDelay: null,
            serverRetryDelay: null,
            maxReconnectDelay: null,
        });
    });

    it("should pass lastDelay to custom strategy on subsequent attempts", () => {
        const customFn = jest.fn((ctx) =>
            ctx.lastDelay === null ? 500 : ctx.lastDelay + 200
        );
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "custom",
            customReconnectDelay: customFn,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);
        expect(setTimeoutSpy).toHaveBeenNthCalledWith(
            1,
            expect.any(Function),
            500
        );

        jest.runOnlyPendingTimers();
        sse.xhr.trigger("error", errorEvent);
        expect(setTimeoutSpy).toHaveBeenNthCalledWith(
            2,
            expect.any(Function),
            700
        );
    });

    it("should cap custom delay at maxReconnectDelay but honor server retry floor", () => {
        const customFn = jest.fn(() => 500);
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "custom",
            customReconnectDelay: customFn,
            maxReconnectDelay: 300,
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.responseText = "retry: 800\n\n";
        sse.xhr.trigger("progress", {});
        sse.xhr.trigger("error", errorEvent);

        // custom returns 500, capped to 300, but server floor 800 overrides
        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            800
        );
    });

    it("should fall back to fixed delay when custom strategy has no callback", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1200,
            reconnectDelayStrategy: "custom",
            // no customReconnectDelay provided
        });
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(setTimeoutSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            1200
        );
    });

    it("should emit reconnect-attempt event with correct payload", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "fixed",
        });
        const events = [];
        sse.addEventListener("reconnect-attempt", (e) => {
            events.push({
                retryCount: e.retryCount,
                delay: e.delay,
                strategy: e.strategy,
                serverRetryDelay: e.serverRetryDelay,
            });
        });

        sse.stream();
        sse.xhr.trigger("error", errorEvent);

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
            retryCount: 0,
            delay: 1000,
            strategy: "fixed",
            serverRetryDelay: null,
        });
    });

    it("should emit reconnect-attempt with server retry delay in payload", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "fixed",
        });
        const events = [];
        sse.addEventListener("reconnect-attempt", (e) => {
            events.push({
                retryCount: e.retryCount,
                delay: e.delay,
                strategy: e.strategy,
                serverRetryDelay: e.serverRetryDelay,
            });
        });

        sse.stream();
        sse.xhr.responseText = "retry: 4000\n\n";
        sse.xhr.trigger("progress", {});
        sse.xhr.trigger("error", errorEvent);

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
            retryCount: 0,
            delay: 4000,
            strategy: "fixed",
            serverRetryDelay: 4000,
        });
    });

    it("should emit reconnect-succeeded event after successful reconnect", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "fixed",
        });
        const succeededEvents = [];
        sse.addEventListener("reconnect-succeeded", (e) => {
            succeededEvents.push({
                retryCount: e.retryCount,
                delay: e.delay,
                strategy: e.strategy,
                serverRetryDelay: e.serverRetryDelay,
            });
        });

        sse.stream();
        sse.xhr.trigger("error", errorEvent);
        jest.runOnlyPendingTimers();

        sse.xhr.responseText = "data: ok\n\n";
        sse.xhr.trigger("progress", {});

        expect(succeededEvents).toHaveLength(1);
        expect(succeededEvents[0]).toEqual({
            retryCount: 0,
            delay: 1000,
            strategy: "fixed",
            serverRetryDelay: null,
        });
    });

    it("should not emit reconnect-succeeded on initial connection (no prior reconnect)", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
        });
        const succeededEvents = [];
        sse.addEventListener("reconnect-succeeded", (e) => {
            succeededEvents.push(e);
        });

        sse.stream();
        sse.xhr.responseText = "data: hello\n\n";
        sse.xhr.trigger("progress", {});

        expect(succeededEvents).toHaveLength(0);
    });

    it("should emit reconnect-succeeded with correct retryCount from attempt", () => {
        const sse = new SSE("http://example.com", {
            start: false,
            autoReconnect: true,
            reconnectDelay: 1000,
            reconnectDelayStrategy: "exponential",
        });
        const succeededEvents = [];
        sse.addEventListener("reconnect-succeeded", (e) => {
            succeededEvents.push({ retryCount: e.retryCount, delay: e.delay });
        });

        sse.stream();
        // First failure
        sse.xhr.trigger("error", errorEvent);
        jest.runOnlyPendingTimers(); // retryCount -> 1

        // Second failure (delay = 1000 * 2^1 = 2000)
        sse.xhr.trigger("error", errorEvent);
        jest.runOnlyPendingTimers(); // retryCount -> 2

        // Successful reconnect after second failure
        sse.xhr.responseText = "data: ok\n\n";
        sse.xhr.trigger("progress", {});

        expect(succeededEvents).toHaveLength(1);
        // retryCount=1 and delay=2000 were captured when the second reconnect was scheduled
        expect(succeededEvents[0]).toEqual({ retryCount: 1, delay: 2000 });
    });
});