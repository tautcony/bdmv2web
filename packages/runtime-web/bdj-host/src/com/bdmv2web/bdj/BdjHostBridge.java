package com.bdmv2web.bdj;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Line-based RPC bridge between Java API shims and the packaged browser host. */
public final class BdjHostBridge {
    public interface InputSink { void dispatch(int keyCode, int modifiers, int eventType); }
    public interface PointerSink { void dispatch(int x, int y); }
    public interface TitleSink { void dispatch(String bdjoId, int title, boolean started, boolean restart); }
    public interface ShutdownSink { void dispatch(); }
    public interface PlayerSink { void dispatch(String event); }
    private static final AtomicLong sequence = new AtomicLong();
    private static final Map<Long, String> responses = new ConcurrentHashMap<Long, String>();
    private static final Object responseLock = new Object();
    private static volatile InputSink inputSink = (key, modifiers, eventType) -> { };
    private static volatile PointerSink pointerSink = (x, y) -> { };
    private static volatile TitleSink titleSink = (bdjoId, title, started, restart) -> { };
    private static volatile ShutdownSink shutdownSink = () -> { };
    private static final Map<String, PlayerSink> playerSinks = new ConcurrentHashMap<String, PlayerSink>();
    private static volatile boolean started;
    private static volatile PrintStream protocolOutput;
    private static final ExecutorService callbacks = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "bdmv-web-bdj-callbacks"); t.setDaemon(true); return t; });
    private BdjHostBridge() { }

    public static synchronized void start() {
        if (started) return;
        started = true;
        protocolOutput = System.out;
        System.setOut(new PrintStream(System.err, true));
        Thread pump = new Thread(() -> {
            try {
                BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
                String line;
                while ((line = reader.readLine()) != null) accept(line);
            } catch (Throwable error) { trace("bridge", "stdin", "error", error.toString()); }
        }, "bdmv-web-bdj-stdin");
        pump.setDaemon(true); pump.start();
    }

    public static void setInputSink(InputSink sink) { inputSink = sink == null ? (key, modifiers, eventType) -> { } : sink; }
    public static void setPointerSink(PointerSink sink) { pointerSink = sink == null ? (x, y) -> { } : sink; }
    public static void setTitleSink(TitleSink sink) { titleSink = sink == null ? (bdjoId, title, started, restart) -> { } : sink; }
    public static void setShutdownSink(ShutdownSink sink) { shutdownSink = sink == null ? () -> { } : sink; }
    public static void registerPlayer(String id, PlayerSink sink) { if (id != null && sink != null) playerSinks.put(id, sink); }
    public static void unregisterPlayer(String id) { if (id != null) playerSinks.remove(id); }

    public static String call(String operation, String... arguments) {
        start();
        if ("selectTitle".equals(operation) || "playerPlaylist".equals(operation)) {
            trace("com.bdmv2web.bdj.BdjHostBridge", "call", operation,
                "arguments=" + java.util.Arrays.toString(arguments) + " caller=" + traceCaller());
        }
        long id = sequence.incrementAndGet();
        StringBuilder payload = new StringBuilder();
        for (int index = 0; index < arguments.length; index++) { if (index > 0) payload.append('\u001f'); payload.append(arguments[index] == null ? "" : arguments[index]); }
        String encoded = Base64.getEncoder().encodeToString(payload.toString().getBytes(StandardCharsets.UTF_8));
        synchronized (protocolOutput) { protocolOutput.println("BDMV_RPC\t" + id + "\t" + operation + "\t" + encoded); protocolOutput.flush(); }
        synchronized (responseLock) {
            long deadline = System.currentTimeMillis() + 30000L;
            while (!responses.containsKey(id)) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) throw new IllegalStateException("Timed out waiting for browser host response to " + operation + ".");
                try { responseLock.wait(remaining); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException("Interrupted while waiting for browser host response.", error); }
            }
            String result = responses.remove(id);
            if (result.startsWith("ERROR: ")) throw new IllegalStateException(result.substring(7));
            return result;
        }
    }

    public static void trace(String className, String method, String location, String detail) {
        String[] fields = { className, method, location, detail };
        StringBuilder encoded = new StringBuilder();
        for (int index = 0; index < fields.length; index++) { if (index > 0) encoded.append('\t'); encoded.append(Base64.getEncoder().encodeToString(fields[index].getBytes(StandardCharsets.UTF_8))); }
        PrintStream output = protocolOutput == null ? System.out : protocolOutput;
        synchronized (output) { output.println("BDMV_TRACE\t" + encoded); output.flush(); }
    }

    public static String traceCaller() {
        StackTraceElement[] stack = Thread.currentThread().getStackTrace();
        StringBuilder value = new StringBuilder();
        for (int index = 3; index < Math.min(stack.length, 8); index++) {
            if (index > 3) value.append(" <- ");
            value.append(stack[index].getClassName()).append('.').append(stack[index].getMethodName());
        }
        return value.toString();
    }

    public static void presentFrame(byte[] png) {
        PrintStream output = protocolOutput == null ? System.out : protocolOutput;
        synchronized (output) { output.println("BDMV_FRAME\t" + Base64.getEncoder().encodeToString(png)); output.flush(); }
    }

    private static void accept(String line) {
        String[] parts = line.split("\\t", -1);
        if (parts.length >= 3 && "BDMV_RES".equals(parts[0])) {
            long id = Long.parseLong(parts[1]);
            String value = new String(Base64.getDecoder().decode(parts[2]), StandardCharsets.UTF_8);
            synchronized (responseLock) { responses.put(id, value); responseLock.notifyAll(); }
        } else if (parts.length >= 4 && "BDMV_EVENT".equals(parts[0])) {
            String value = new String(Base64.getDecoder().decode(parts[3]), StandardCharsets.UTF_8);
            callbacks.execute(() -> {
                if ("input".equals(parts[1])) { String[] args = value.split("\\|", -1); inputSink.dispatch(Integer.parseInt(args[0]), args.length > 1 ? Integer.parseInt(args[1]) : 0, args.length > 2 ? Integer.parseInt(args[2]) : java.awt.event.KeyEvent.KEY_PRESSED); }
                else if ("pointer".equals(parts[1])) { String[] args = value.split("\\|", -1); pointerSink.dispatch(Integer.parseInt(args[0]), Integer.parseInt(args[1])); }
                else if ("title".equals(parts[1])) { String[] args = value.split("\\|", -1); titleSink.dispatch(parts[2], Integer.parseInt(args[0]), args.length > 1 && "start".equals(args[1]), args.length > 2 && Boolean.parseBoolean(args[2])); }
                else if ("player".equals(parts[1])) {
                    String playerId = parts[2];
                    PlayerSink sink = playerSinks.get(playerId);
                    trace("com.bdmv2web.bdj.BdjHostBridge", "playerEvent", sink == null ? "unmatched" : "dispatch", "playerId=" + playerId + " event=" + value);
                    if (sink != null) sink.dispatch(value);
                }
                else if ("shutdown".equals(parts[1])) shutdownSink.dispatch();
            });
        }
    }
}
