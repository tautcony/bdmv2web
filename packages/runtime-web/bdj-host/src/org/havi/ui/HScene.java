package org.havi.ui;

import com.bdmv2web.bdj.BdjHostBridge;
import java.awt.Container;
import java.awt.Component;
import java.awt.EventQueue;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;

/** Headless HAVi scene whose current AWT component tree is painted into the browser canvas. */
public class HScene extends Container {
    private static final long serialVersionUID = 1L;
    private static final CopyOnWriteArrayList<HScene> SCENES = new CopyOnWriteArrayList<HScene>();
    private static final ScheduledExecutorService RENDERER = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "bdmv-web-hscene-renderer");
        thread.setDaemon(true);
        return thread;
    });
    static {
        RENDERER.scheduleAtFixedRate(() -> {
            for (HScene scene : SCENES) if (scene.isVisible()) EventQueue.invokeLater(scene::renderFrame);
        }, 0L, 200L, TimeUnit.MILLISECONDS);
    }

    private volatile int backgroundMode;
    private final java.awt.Panel offscreenRoot;
    private BufferedImage frame;
    private BufferedImage directFrame;
    private int previousFrameHash;
    private long emittedFrameCount;
    private boolean emptyFrameTraced;
    private boolean contentFrameTraced;

    public HScene() {
        setLayout(null);
        setBounds(0, 0, 1920, 1080);
        setFocusable(true);
        offscreenRoot = new java.awt.Panel(null);
        offscreenRoot.setBounds(0, 0, getWidth(), getHeight());
        offscreenRoot.add(this);
        offscreenRoot.addNotify();
        SCENES.add(this);
    }

    public void setBackgroundMode(int mode) { backgroundMode = mode; repaint(); }
    public int getBackgroundMode() { return backgroundMode; }

    public static void dispatchRemoteKey(int keyCode, int modifiers) {
        dispatchRemoteKey(keyCode, modifiers, KeyEvent.KEY_PRESSED);
    }

    public static void dispatchRemoteKey(int keyCode, int modifiers, int eventType) {
        EventQueue.invokeLater(() -> {
            for (HScene scene : SCENES) if (scene.isVisible()) {
                BdjHostBridge.trace("org.havi.ui.HScene", "dispatchRemoteKey", "target",
                    "keyCode=" + keyCode + " modifiers=" + modifiers + " eventType=" + eventType
                        + " children=" + scene.getComponentCount() + " keyListeners=" + scene.getKeyListeners().length
                        + " focusOwner=" + scene.isFocusOwner());
                KeyEvent event = new KeyEvent(scene, eventType, System.currentTimeMillis(), modifiers, keyCode, KeyEvent.CHAR_UNDEFINED);
                scene.processKeyEvent(event);
            }
        });
    }

    public static void dispatchRemotePointer(int x, int y) {
        EventQueue.invokeLater(() -> {
            long when = System.currentTimeMillis();
            for (HScene scene : SCENES) if (scene.isVisible()) {
                Component target = scene.findComponentAt(x, y);
                if (target == null) target = scene;
                int localX = x;
                int localY = y;
                for (Component current = target; current != scene && current != null; current = current.getParent()) {
                    localX -= current.getX();
                    localY -= current.getY();
                }
                target.dispatchEvent(new MouseEvent(target, MouseEvent.MOUSE_PRESSED, when, MouseEvent.BUTTON1_DOWN_MASK, localX, localY, x, y, 1, false, MouseEvent.BUTTON1));
                target.dispatchEvent(new MouseEvent(target, MouseEvent.MOUSE_RELEASED, when, 0, localX, localY, x, y, 1, false, MouseEvent.BUTTON1));
                target.dispatchEvent(new MouseEvent(target, MouseEvent.MOUSE_CLICKED, when, 0, localX, localY, x, y, 1, false, MouseEvent.BUTTON1));
            }
        });
    }

    @Override public void repaint(long delay, int x, int y, int width, int height) {
        if (EventQueue.isDispatchThread()) renderFrame();
        else EventQueue.invokeLater(this::renderFrame);
    }

    @Override public Graphics getGraphics() {
        ensureFrame();
        return directFrame == null ? null : directFrame.createGraphics();
    }

    @Override public java.awt.Image createImage(int width, int height) {
        if (width <= 0 || height <= 0) return null;
        return new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    }

    @Override public void setVisible(boolean visible) {
        super.setVisible(visible);
        if (visible) repaint();
    }

    public void dispose() {
        setVisible(false);
        SCENES.remove(this);
        offscreenRoot.remove(this);
        offscreenRoot.removeNotify();
        if (frame != null) frame.flush();
        if (directFrame != null) directFrame.flush();
    }

    private void ensureFrame() {
        int width = Math.max(1, getWidth());
        int height = Math.max(1, getHeight());
        if (frame == null || frame.getWidth() != width || frame.getHeight() != height || directFrame == null || directFrame.getWidth() != width || directFrame.getHeight() != height) {
            frame = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            directFrame = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            previousFrameHash = 0;
        }
    }

    private void renderFrame() {
        if (!isVisible()) return;
        ensureFrame();
        if (frame == null) return;
        Graphics2D graphics = frame.createGraphics();
        try {
            graphics.setComposite(java.awt.AlphaComposite.Clear);
            graphics.fillRect(0, 0, frame.getWidth(), frame.getHeight());
            graphics.setComposite(java.awt.AlphaComposite.SrcOver);
            graphics.drawImage(directFrame, 0, 0, null);
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            super.paint(graphics);
        } finally { graphics.dispose(); }
        int[] pixels = frame.getRGB(0, 0, frame.getWidth(), frame.getHeight(), null, 0, frame.getWidth());
        int hash = Arrays.hashCode(pixels);
        if (hash == previousFrameHash) return;
        previousFrameHash = hash;
        emittedFrameCount++;
        int opaquePixels = 0;
        int minX = frame.getWidth(); int minY = frame.getHeight(); int maxX = -1; int maxY = -1;
        for (int y = 0; y < frame.getHeight(); y++) for (int x = 0; x < frame.getWidth(); x++) {
            if ((pixels[y * frame.getWidth() + x] >>> 24) == 0) continue;
            opaquePixels++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        boolean hasContent = opaquePixels > 0;
        if ((!hasContent && !emptyFrameTraced) || (hasContent && !contentFrameTraced)) {
            int visibleComponents = countVisibleComponents(this);
            BdjHostBridge.trace("org.havi.ui.HScene", "renderFrame", "frame",
                "frame=" + emittedFrameCount + " width=" + frame.getWidth() + " height=" + frame.getHeight()
                    + " nonTransparentPixels=" + opaquePixels + " bounds=" + (hasContent ? minX + "," + minY + "," + maxX + "," + maxY : "empty")
                    + " visibleComponents=" + visibleComponents);
            if (hasContent) contentFrameTraced = true; else emptyFrameTraced = true;
        }
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            ImageIO.write(frame, "png", output);
            BdjHostBridge.presentFrame(output.toByteArray());
        } catch (Exception error) { BdjHostBridge.trace("org.havi.ui.HScene", "renderFrame", "error", error.toString()); }
    }

    private static int countVisibleComponents(Component component) {
        if (!component.isVisible()) return 0;
        int count = 1;
        if (component instanceof Container) for (Component child : ((Container) component).getComponents()) count += countVisibleComponents(child);
        return count;
    }
}
