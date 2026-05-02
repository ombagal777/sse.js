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
});