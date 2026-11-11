import java.net.URL;
import java.net.URLClassLoader;
import java.rmi.NotBoundException;
import java.rmi.RemoteException;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
import javax.tv.xlet.XletContext;
import org.dvb.io.ixc.IxcRegistry;

public final class IxcRegistryProbe {
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    public static void main(String[] args) throws Exception {
        URL jar = new File(args[0]).toURI().toURL();
        URLClassLoader loaderA = new URLClassLoader(new URL[] { jar }, IxcRegistryProbe.class.getClassLoader());
        URLClassLoader loaderB = new URLClassLoader(new URL[] { jar }, IxcRegistryProbe.class.getClassLoader());
        Context contextA = new Context("7fff0001", "1001", loaderA);
        Context contextB = new Context("7fff0001", "1002", loaderB);
        Class<?> echoA = loaderA.loadClass("fixture.ixc.Echo");
        Class<?> echoB = loaderB.loadClass("fixture.ixc.Echo");
        require(echoA != echoB, "Synthetic Xlet interfaces unexpectedly share class identity.");

        java.rmi.Remote remoteA = (java.rmi.Remote) loaderA.loadClass("fixture.ixc.EchoImpl").getConstructor(int.class).newInstance(10);
        java.rmi.Remote remoteB = (java.rmi.Remote) loaderB.loadClass("fixture.ixc.EchoImpl").getConstructor(int.class).newInstance(20);
        IxcRegistry.bind(contextA, "Echo", remoteA);
        IxcRegistry.bind(contextB, "Echo", remoteB);

        Object proxyB = IxcRegistry.lookup(contextB, "/7fff0001/1001/Echo");
        Object proxyBAgain = IxcRegistry.lookup(contextB, "/7fff0001/1001/Echo");
        require(proxyB.getClass().getClassLoader() == loaderB && proxyB.getClass().getInterfaces()[0] == echoB, "Provider A was not proxied into Xlet B's classloader.");
        require(proxyB == proxyBAgain, "Repeated lookup did not preserve the imported proxy identity.");
        require(((Integer) echoB.getMethod("echo", int.class).invoke(proxyB, 2)).intValue() == 12, "Xlet B did not invoke the provider A method.");
        try { echoB.getMethod("fail").invoke(proxyB); throw new IllegalStateException("RemoteException was not propagated."); }
        catch (java.lang.reflect.InvocationTargetException error) { require(error.getCause() instanceof RemoteException, "Remote exception mapping changed: " + error.getCause()); }

        Object proxyA = IxcRegistry.lookup(contextA, "/7fff0001/1002/Echo");
        require(proxyA.getClass().getClassLoader() == loaderA && proxyA.getClass().getInterfaces()[0] == echoA, "Provider B was not proxied into Xlet A's classloader.");
        require(((Integer) echoA.getMethod("echo", int.class).invoke(proxyA, 2)).intValue() == 22, "Xlet A did not invoke provider B.");

        IxcRegistry.unbindAll(contextA);
        try { IxcRegistry.lookup(contextB, "/7fff0001/1001/Echo"); throw new IllegalStateException("Unbound provider remained visible."); }
        catch (NotBoundException expected) { }
        try { echoB.getMethod("echo", int.class).invoke(proxyB, 2); throw new IllegalStateException("Proxy invoked a destroyed provider."); }
        catch (java.lang.reflect.InvocationTargetException error) { require(error.getCause() instanceof RemoteException, "Destroyed provider error mapping changed."); }
        IxcRegistry.unbindAll(contextB);
        try { IxcRegistry.lookup(contextA, "/7fff0001/1001/Echo"); throw new IllegalStateException("Lookup after unbindAll did not report a missing binding."); }
        catch (NotBoundException expected) { }
        loaderA.close(); loaderB.close();
        System.err.println("IXC_PROXY_OK bidirectional identity exception unbind");
        System.exit(0);
    }

    private static final class Context implements XletContext {
        private final Map<String, Object> properties = new HashMap<String, Object>();
        private final ClassLoader loader;
        Context(String organizationId, String applicationId, ClassLoader loader) {
            properties.put("dvb.org.id", organizationId); properties.put("dvb.app.id", applicationId); this.loader = loader;
        }
        public Object getXletProperty(String key) { return properties.get(key); }
        public void notifyDestroyed() { }
        public void notifyPaused() { }
        public void resumeRequest() { }
        public ClassLoader getClassLoader() { return loader; }
    }
}
