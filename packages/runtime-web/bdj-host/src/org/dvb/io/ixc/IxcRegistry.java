package org.dvb.io.ixc;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.rmi.AlreadyBoundException;
import java.rmi.NotBoundException;
import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.lang.ref.WeakReference;
import javax.tv.xlet.XletContext;

/** Local IXC registry with caller-loader Remote proxies for cross-Xlet lookups. */
public class IxcRegistry {
    private static final Map<String, Binding> OBJECTS = new java.util.concurrent.ConcurrentHashMap<String, Binding>();
    private static final Map<XletContext, Map<Remote, WeakReference<Remote>>> IMPORTS = new WeakHashMap<XletContext, Map<Remote, WeakReference<Remote>>>();
    private static final Set<XletContext> RELEASED = Collections.newSetFromMap(new WeakHashMap<XletContext, Boolean>());

    public IxcRegistry() { }

    public static Remote lookup(XletContext context, String name) throws NotBoundException, RemoteException {
        String key = lookupKey(name);
        Binding binding = OBJECTS.get(key);
        if (binding == null) throw new NotBoundException(name);
        return adapt(binding.remote, binding.owner, context);
    }

    public static void bind(XletContext context, String name, Remote remote) throws AlreadyBoundException, RemoteException {
        if (name == null || name.isEmpty() || remote == null) throw new IllegalArgumentException("IXC binding requires a name and remote object.");
        if (context == null) throw new NullPointerException("IXC context is required.");
        String key = contextKey(context, name);
        synchronized (RELEASED) { RELEASED.remove(context); }
        if (OBJECTS.putIfAbsent(key, new Binding(context, remote)) != null) throw new AlreadyBoundException(name);
    }

    public static void unbind(XletContext context, String name) throws NotBoundException, RemoteException {
        Binding removed = OBJECTS.remove(contextKey(context, name));
        if (removed == null) throw new NotBoundException(name);
        removeImports(removed.remote);
    }

    public static void unbindAll(XletContext context) {
        if (context == null) return;
        String prefix = contextPrefix(context);
        for (Map.Entry<String, Binding> entry : OBJECTS.entrySet()) {
            if (entry.getKey().startsWith(prefix) && OBJECTS.remove(entry.getKey(), entry.getValue())) removeImports(entry.getValue().remote);
        }
        synchronized (IMPORTS) { IMPORTS.remove(context); }
        synchronized (RELEASED) { RELEASED.add(context); }
    }

    private static Remote adapt(Remote remote, XletContext owner, XletContext requester) throws RemoteException {
        if (requester == null) throw new RemoteException("IXC lookup has no requesting Xlet context.");
        if (owner == requester) return remote;
        ClassLoader callerLoader = requester.getClassLoader();
        if (callerLoader == null || callerLoader == remote.getClass().getClassLoader()) return remote;
        synchronized (IMPORTS) {
            Map<Remote, WeakReference<Remote>> imported = IMPORTS.get(requester);
            if (imported == null) { imported = new IdentityHashMap<Remote, WeakReference<Remote>>(); IMPORTS.put(requester, imported); }
            WeakReference<Remote> existing = imported.get(remote);
            Remote proxy = existing == null ? null : existing.get();
            if (proxy != null) return proxy;
            Set<Class<?>> interfaces = remoteInterfaces(remote.getClass(), callerLoader);
            if (interfaces.isEmpty()) throw new RemoteException("The requesting Xlet cannot load a Remote interface for the IXC object.");
            proxy = (Remote) Proxy.newProxyInstance(callerLoader, interfaces.toArray(new Class<?>[0]), new RemoteInvocation(remote, owner, requester));
            imported.put(remote, new WeakReference<Remote>(proxy));
            return proxy;
        }
    }

    private static Set<Class<?>> remoteInterfaces(Class<?> type, ClassLoader loader) throws RemoteException {
        Set<Class<?>> declared = new LinkedHashSet<Class<?>>();
        collectRemoteInterfaces(type, declared);
        Set<Class<?>> visible = new LinkedHashSet<Class<?>>();
        for (Class<?> candidate : declared) {
            try {
                Class<?> clientType = Class.forName(candidate.getName(), false, loader);
                if (clientType.isInterface() && Remote.class.isAssignableFrom(clientType)) visible.add(clientType);
            } catch (ClassNotFoundException error) {
                throw new RemoteException("The requesting Xlet cannot load IXC interface " + candidate.getName() + ".", error);
            }
        }
        return visible;
    }

    private static void collectRemoteInterfaces(Class<?> type, Set<Class<?>> found) {
        if (type == null) return;
        for (Class<?> candidate : type.getInterfaces()) {
            if (Remote.class.isAssignableFrom(candidate)) found.add(candidate);
            collectRemoteInterfaces(candidate, found);
        }
        collectRemoteInterfaces(type.getSuperclass(), found);
    }

    private static void removeImports(Remote remote) {
        synchronized (IMPORTS) {
            for (Map<Remote, WeakReference<Remote>> imported : IMPORTS.values()) imported.remove(remote);
        }
    }

    private static String contextKey(XletContext context, String name) {
        if (context == null || name == null) throw new NullPointerException("IXC context and name are required.");
        return contextPrefix(context) + name;
    }

    private static String contextPrefix(XletContext context) {
        return "/" + hex(context.getXletProperty("dvb.org.id").toString()) + "/"
            + hex(context.getXletProperty("dvb.app.id").toString()) + "/";
    }

    private static String lookupKey(String path) {
        String[] parts = path.split("/", 4);
        if (parts.length != 4 || !parts[0].isEmpty() || parts[3].isEmpty()) throw new IllegalArgumentException("IXC lookup requires /organization/application/name.");
        return "/" + hex(parts[1]) + "/" + hex(parts[2]) + "/" + parts[3];
    }

    private static String hex(String value) { return Long.toHexString(Long.parseLong(value, 16)); }

    private static final class Binding {
        final XletContext owner;
        final Remote remote;
        Binding(XletContext owner, Remote remote) { this.owner = owner; this.remote = remote; }
    }

    private static final class RemoteInvocation implements InvocationHandler {
        private final Remote target;
        private final XletContext owner;
        private final XletContext requester;
        RemoteInvocation(Remote target, XletContext owner, XletContext requester) { this.target = target; this.owner = owner; this.requester = requester; }
        public Object invoke(Object proxy, Method method, Object[] arguments) throws Throwable {
            if (method.getDeclaringClass() == Object.class) {
                if ("equals".equals(method.getName())) {
                    Object other = arguments == null || arguments.length == 0 ? null : arguments[0];
                    return proxy == other || (Proxy.isProxyClass(other == null ? Object.class : other.getClass())
                        && Proxy.getInvocationHandler(other) instanceof RemoteInvocation
                        && ((RemoteInvocation) Proxy.getInvocationHandler(other)).target == target);
                }
                if ("hashCode".equals(method.getName())) return System.identityHashCode(target);
                if ("toString".equals(method.getName())) return "IXC proxy for " + target.getClass().getName();
            }
            synchronized (RELEASED) {
                if (RELEASED.contains(owner) || RELEASED.contains(requester)) throw new RemoteException("IXC caller or callee has been destroyed.");
            }
            Class<?>[] targetParameters = new Class<?>[method.getParameterTypes().length];
            ClassLoader targetLoader = target.getClass().getClassLoader();
            Object[] targetArguments = arguments == null ? null : arguments.clone();
            for (int index = 0; index < targetParameters.length; index++) {
                Class<?> callerType = method.getParameterTypes()[index];
                targetParameters[index] = resolveType(callerType, targetLoader);
                if (arguments != null && arguments[index] instanceof Remote) targetArguments[index] = adapt((Remote) arguments[index], requester, owner);
            }
            try {
                com.bdmv2web.bdj.BdjHostBridge.trace(target.getClass().getName(), method.getName(), "ixc-call",
                    "owner=" + applicationId(owner) + " requester=" + applicationId(requester)
                        + " arguments=" + java.util.Arrays.toString(arguments)
                        + " caller=" + caller());
                Object result = target.getClass().getMethod(method.getName(), targetParameters).invoke(target, targetArguments);
                return result instanceof Remote ? adapt((Remote) result, owner, requester) : result;
            } catch (InvocationTargetException error) { throw error.getCause(); }
        }
        private static String applicationId(XletContext context) {
            Object organization = context.getXletProperty("dvb.org.id");
            Object application = context.getXletProperty("dvb.app.id");
            return String.valueOf(organization) + ":" + String.valueOf(application);
        }
        private static String caller() {
            StackTraceElement[] stack = Thread.currentThread().getStackTrace();
            StringBuilder value = new StringBuilder();
            for (int index = 3; index < Math.min(stack.length, 8); index++) {
                if (index > 3) value.append(" <- ");
                value.append(stack[index].getClassName()).append('.').append(stack[index].getMethodName());
            }
            return value.toString();
        }
        private static Class<?> resolveType(Class<?> type, ClassLoader loader) throws ClassNotFoundException {
            if (type.isPrimitive() || type.getClassLoader() == null) return type;
            return Class.forName(type.getName(), false, loader);
        }
    }
}
