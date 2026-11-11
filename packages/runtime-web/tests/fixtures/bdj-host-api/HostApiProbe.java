import java.awt.Color;
import java.awt.Component;
import java.awt.EventQueue;
import java.awt.Graphics;
import java.awt.event.KeyAdapter;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.dvb.event.EventManager;
import org.dvb.event.UserEvent;
import org.dvb.event.UserEventListener;
import org.dvb.event.UserEventRepository;
import org.havi.ui.HScene;

public final class HostApiProbe {
    public static void main(String[] args) throws Exception {
        try { verify(); System.exit(0); }
        catch (Throwable error) { error.printStackTrace(); System.exit(1); }
    }

    private static void verify() throws Exception {
        HScene scene = new HScene();
        BufferedImage image = (BufferedImage) scene.createImage(16, 12);
        Graphics graphics = image.getGraphics();
        graphics.setColor(Color.MAGENTA);
        graphics.fillRect(4, 3, 2, 2);
        graphics.dispose();
        require(image.getRGB(4, 3) == 0xffff00ff, "ARGB drawing pixel");
        require(image.getRGB(0, 0) == 0, "transparent image pixel");

        PrintStream originalOutput = System.out;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        System.setOut(new PrintStream(output, true));
        scene.setBounds(0, 0, 32, 24);
        Component child = new Component() {
            @Override public void paint(Graphics graphics) {
                graphics.setColor(Color.GREEN);
                graphics.fillRect(0, 0, getWidth(), getHeight());
            }
        };
        child.setBounds(8, 6, 4, 4);
        scene.add(child);
        EventQueue.invokeAndWait(scene::repaint);
        String[] lines = output.toString("UTF-8").split("\\r?\\n");
        BufferedImage presented = null;
        for (String line : lines) if (line.startsWith("BDMV_FRAME\t")) {
            presented = ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(line.substring(11))));
        }
        System.setOut(originalOutput);
        require(presented != null && presented.getRGB(8, 6) == 0xff00ff00, "component tree frame pixel");

        List<Integer> awtTypes = new ArrayList<Integer>();
        scene.addKeyListener(new KeyAdapter() {
            @Override public void keyPressed(KeyEvent event) { awtTypes.add(event.getID()); }
            @Override public void keyReleased(KeyEvent event) { awtTypes.add(event.getID()); }
        });
        HScene.dispatchRemoteKey(KeyEvent.VK_ENTER, 0, KeyEvent.KEY_PRESSED);
        HScene.dispatchRemoteKey(KeyEvent.VK_ENTER, 0, KeyEvent.KEY_RELEASED);
        EventQueue.invokeAndWait(() -> { });
        require(awtTypes.equals(Arrays.asList(401, 402)), "AWT press and release");
        List<Integer> pointerCoordinates = new ArrayList<Integer>();
        child.addMouseListener(new MouseAdapter() {
            @Override public void mouseClicked(MouseEvent event) { pointerCoordinates.add(event.getX()); pointerCoordinates.add(event.getY()); }
        });
        HScene.dispatchRemotePointer(9, 7);
        EventQueue.invokeAndWait(() -> { });
        require(pointerCoordinates.equals(Arrays.asList(1, 1)), "component-local pointer coordinates");

        List<Integer> dvbTypes = new ArrayList<Integer>();
        UserEventRepository repository = new UserEventRepository("navigation");
        repository.addKey(KeyEvent.VK_ENTER);
        UserEventListener listener = event -> {
            require(event.getSource() == EventManager.getInstance(), "DVB event source");
            require(event.getFamily() == 1 && event.getCode() == KeyEvent.VK_ENTER, "DVB key identity");
            dvbTypes.add(event.getType());
        };
        EventManager.getInstance().addUserEventListener(listener, repository);
        EventManager.getInstance().dispatch(KeyEvent.VK_ENTER, 0, KeyEvent.KEY_PRESSED);
        EventManager.getInstance().dispatch(KeyEvent.VK_ENTER, 0, KeyEvent.KEY_RELEASED);
        EventManager.getInstance().removeUserEventListener(listener);
        require(dvbTypes.equals(Arrays.asList(401, 402)), "DVB press and release");

        require(Exception.class.isAssignableFrom(org.havi.ui.HConfigurationException.class), "HAVi exception hierarchy");
        require(Exception.class.isAssignableFrom(org.dvb.ui.FontFormatException.class), "DVB exception hierarchy");
        require(javax.tv.media.MediaSelectListener.class.isInterface(), "media listener interface");
        require(org.bluray.storage.DataAreaInfo.class.isInterface(), "storage interface");
        require(org.havi.ui.HVideoConfigTemplate.class.isAssignableFrom(org.bluray.ui.BDVideoConfigTemplate.class), "video template hierarchy");
        javax.tv.xlet.XletContext context = new javax.tv.xlet.XletContext() {
            public Object getXletProperty(String key) { return "dvb.org.id".equals(key) ? "00000011" : "0002"; }
            public void notifyDestroyed() { }
            public void notifyPaused() { }
            public void resumeRequest() { }
            public ClassLoader getClassLoader() { return HostApiProbe.class.getClassLoader(); }
        };
        java.rmi.Remote messenger = new java.rmi.Remote() { };
        org.dvb.io.ixc.IxcRegistry.bind(context, "Messenger", messenger);
        require(org.dvb.io.ixc.IxcRegistry.lookup(context, "/11/2/Messenger") == messenger, "IXC application namespace");
        org.dvb.io.ixc.IxcRegistry.unbind(context, "Messenger");
        System.out.println("HOST_API_PROBE_OK pixels=ffff00ff,00000000 awt=401,402 dvb=401,402");
        scene.dispose();
    }

    private static void require(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }
}
