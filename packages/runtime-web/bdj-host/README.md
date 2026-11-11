# BD-J host classes

`bdj-host-api.jar` is the Java-side Xlet entrypoint and host API layer bundled into BD-J packages. It runs in the native Java process started by `bdmv2web serve`. The sources target Java 8 bytecode for BD-J application compatibility; use a JDK with `java.desktop` at runtime.

Build with a JDK:

```sh
mkdir -p build/classes
javac --release 8 -d build/classes $(find src -name '*.java')
jar --create --file bdj-host-api.jar -C build/classes .
```
