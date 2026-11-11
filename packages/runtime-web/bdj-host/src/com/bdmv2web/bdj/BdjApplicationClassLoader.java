package com.bdmv2web.bdj;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.List;

/** Loads each Xlet's declared JAR class path through its own BDJ class loader. */
final class BdjApplicationClassLoader extends URLClassLoader {
    BdjApplicationClassLoader(BdjApplicationManager.Application application) throws IOException {
        super(applicationJars(application), BdjApplicationClassLoader.class.getClassLoader());
    }

    private static URL[] applicationJars(BdjApplicationManager.Application application) throws IOException {
        String rootText = System.getProperty("bluray.vfs.root", "/bdj");
        File jarDirectory = new File(rootText, "BDMV/JAR").getCanonicalFile();
        List<String> names = new ArrayList<String>();
        names.add(application.basePath);
        if (application.classPath != null && !application.classPath.isEmpty()) {
            for (String item : application.classPath.split("[;:]")) if (!item.isEmpty()) names.add(item);
        }
        List<URL> urls = new ArrayList<URL>();
        for (String raw : names) {
            String name = raw.replace('\\', '/').replaceFirst("^\\./", "");
            if (name.endsWith(".jar") || name.endsWith(".JAR")) name = name.substring(0, name.length() - 4);
            if (name.startsWith("/") || name.isEmpty()) throw new IOException("Application JAR path must remain within BDMV/JAR: " + raw);
            File jar = new File(jarDirectory, name + ".jar").getCanonicalFile();
            if (!jar.toPath().startsWith(jarDirectory.toPath())) throw new IOException("Application JAR path is outside BDMV/JAR: " + raw);
            if (jar.isFile()) urls.add(toUrl(jar));
        }
        return urls.toArray(new URL[0]);
    }

    private static URL toUrl(File file) throws MalformedURLException { return file.toURI().toURL(); }
}
