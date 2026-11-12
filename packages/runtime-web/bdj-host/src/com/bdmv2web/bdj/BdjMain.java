package com.bdmv2web.bdj;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.CountDownLatch;
import javax.tv.xlet.Xlet;
import javax.tv.xlet.XletContext;

/** Starts the applications selected by one BDJO using the browser's Java VM. */
public final class BdjMain {
    private BdjMain() { }

    public static void main(String[] args) throws Exception {
        BdjApplicationManager manager = null;
        try {
            if (args.length < 3) throw new IllegalArgumentException("BD-J startup requires a disc ID, initial BDJO identifier, and application count.");
            if (System.getProperty("bluray.vfs.root") == null) System.setProperty("bluray.vfs.root", "/bdj");
            System.setProperty("java.awt.headless", "true");
            BdjHostBridge.start();
            manager = new BdjApplicationManager();
            manager.setEventSink((name, value) -> BdjHostBridge.call("xletEvent", name, value));
            BdjHostBridge.setInputSink(manager::dispatchInput);
            BdjHostBridge.setPointerSink(manager::dispatchPointer);
            BdjHostBridge.setTitleSink(manager::dispatchTitle);
            CountDownLatch shutdown = new CountDownLatch(1);
            final BdjApplicationManager activeManager = manager;
            BdjHostBridge.setShutdownSink(() -> { activeManager.shutdown(); shutdown.countDown(); });
            int count = Integer.parseInt(args[2]);
            for (int index = 0; index < count; index++) {
                if (index + 3 >= args.length) throw new IllegalArgumentException("BD-J startup application list is truncated.");
                manager.add(decodeApplication(args[index + 3]));
            }
            manager.activate(args[1], 0xffff);
            System.out.println("BDMV_READY");
            System.out.flush();
            BdjHostBridge.trace("runtime", "BdjMain", "main", "disc=" + args[0] + " applications=" + count);
            shutdown.await();
        } catch (Throwable error) {
            BdjHostBridge.trace("runtime", "BdjMain", "startup-error", error.toString());
            if (manager != null) manager.shutdown();
            System.exit(1);
        }
    }

    private static BdjApplicationManager.Application decodeApplication(String encoded) {
        String decoded = new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
        String[] fields = decoded.split("\\|", -1);
        if (fields.length != 9) throw new IllegalArgumentException("BD-J application descriptor has " + fields.length + " fields; expected 9.");
        String parameterText = new String(Base64.getDecoder().decode(fields[8]), StandardCharsets.UTF_8);
        String[] parameters = parameterText.isEmpty() ? new String[0] : parameterText.split("\\n", -1);
        return new BdjApplicationManager.Application(
            fields[0], Integer.parseInt(fields[1]), Integer.parseInt(fields[2]), Integer.parseInt(fields[3]), Integer.parseInt(fields[4]),
            fields[5], fields[6], fields[7], parameters
        );
    }
}
