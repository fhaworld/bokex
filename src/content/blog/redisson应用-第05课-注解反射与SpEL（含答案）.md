---
title: "redisson应用-第05课-注解反射与SpEL（含答案）"
description: "redisson应用系列第05课，主题：注解反射与SpEL（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 05 课：注解、反射、参数名与 SpEL（含答案）

## 1. 本课目标

上一课已知道 AOP 切面能够读取注解并拦截方法。这一课继续追踪：

```java
@ServiceLock(name = "cancel", keys = {"#dto.orderNumber"})
```

这段规则怎样结合本次调用的实参，生成用于竞争的锁名？

学完应能区分注解文本、反射 Method、实参数组、参数名元数据和表达式求值结果，并定位求值失败或锁名错误的原因。

课程入口：[学习导航](damai-redisson-framework-课程学习导航.md)。本课不连接 Redis，主要使用真实反射与 Spring 表达式组件。

## 2. 一条转换链先记住

```text
注解 keys："#dto.orderNumber"
    +
Method：cancel(OrderDto dto)
    +
实参：OrderDto(orderNumber="1001")
    ↓
建立变量 dto → 本次 OrderDto 对象
    ↓
SpEL 读取 orderNumber 属性，得到 "1001"
    ↓
按项目规则拼接前缀、业务 name 和结果
    ↓
damai-SERVICE_LOCK:cancel:1001
```

最后一行假设前缀为 damai、使用 ServiceLockInfoHandle，且其他输入符合本例。key 的内容来自本次调用，不是注解编译时已经固定好的订单号。

## 3. 注解保存的仍然是字符串

ServiceLock 的 keys 类型是 String[]，Retention 为 RUNTIME。运行时切面可以读取注解属性。

```java
String name();
String[] keys();
```

这是字段形状示意，省略了项目中 name 的默认值等。keys 中写了 #，不意味着 Java 编译器会替你执行 SpEL。执行表达式的是后面代码中的 SpelExpressionParser。

另外，name 在当前锁名生成方法中直接参与拼接，没有像 keys 那样逐项调用 parser。不能因为都在同一注解里，就认定它们都自动支持同一种表达式求值。

## 4. Method 与 Object[] args 分别是什么？

假设方法是：

```java
public void cancel(OrderDto dto, String category) {
    // 业务
}
```

| 信息 | 表示什么 | 示例 |
| --- | --- | --- |
| Method | 方法声明与反射信息 | 方法名、参数类型、声明类、注解 |
| 参数名 | 源码给形参取的名字 | dto、category，运行时未必能直接取得 |
| 参数值 | 本次调用传入的对象 | 某个 OrderDto、"vip" |
| Object[] args | 按位置存放的实参 | args[0] 是 DTO，args[1] 是字符串 |

Method 不包含每次调用的实际订单号；Object[] 的第一个槽位也不会自动告诉你源码中它叫 dto。建立这种对应关系需要参数索引或参数名发现。

项目从 MethodSignature 取得 Method，再从 JoinPoint.getArgs 取得实参。

## 5. 反射如何找到方法？

```java
Method method = DemoService.class.getDeclaredMethod(
        "cancel", OrderDto.class, String.class);
```

查找使用方法名与参数类型，不是用本次参数值，也不是只写一个方法名就能区分所有重载。

两个常见入口：

- getDeclaredMethod：查本类声明的方法，包括相应非 public 方法，不自动搜索父类继承方法。
- getMethod：查 public 方法，包含符合条件的继承方法。

拿到 Method 不等于已经执行它。Method.invoke 才是反射调用；解析锁名时主要使用 Method 建立求值上下文，不是在这里重新执行业务。

## 6. 项目为什么从接口 Method 再找目标 Method？

AbstractLockInfoHandle.getMethod 先取签名中的方法。如果声明类是接口，会尝试：

```java
joinPoint.getTarget().getClass().getDeclaredMethod(
        signature.getName(), method.getParameterTypes());
```

这帮助定位目标实现类的方法与参数信息。接口方法与实现方法的参数名元数据可能不同，不能默认完全一致。

但当前 getDeclaredMethod 不是通用地遍历全部继承层次。如果方法实际声明在父类，查找可能失败；catch 记录后仍保留此前的 Method 继续。不能因为有这段代码就认为任何代理与继承情况都已完美处理。

泛型还可能产生桥接方法。项目自定义参数名发现器调用 BridgeMethodResolver，避免直接把某些编译器桥接方法当作业务声明。现在先认识用途，字节码细读留到公共底座源码课。

## 7. 参数名为什么可能变成 arg0？

源码中的 dto 并不保证自动作为反射参数名保留。Java 可以通过编译参数 -parameters 写入相应参数名信息。

```text
保留 MethodParameters：反射可获得源码参数名
未保留：反射可能给出 arg0、arg1 等合成名称
```

Parameter.isNamePresent 用来判断是否有对应的真实参数名信息，不能只看 getName 返回一个非空字符串就断言成功。

另一个机制是调试信息中的 LocalVariableTable。它与 -parameters 是不同的字节码元数据，普通 Java Parameter API 不会因为存在局部变量表就自动返回源码形参名。

因此有三种值得分别测试的编译方式：

| 编译选项示例 | 反射参数名 | 局部变量表回退的可能性 |
| --- | --- | --- |
| -parameters -g:none | 可有真实参数名 | 不依赖局部变量表 |
| -g:vars，不带 -parameters | 普通反射可能只有合成名 | 对有方法体且保留相关信息的方法，可尝试读取 LVT |
| -g:none，不带 -parameters | 缺失真实参数名 | 通常也没有所需 LVT 信息 |

接口抽象方法没有普通方法体的局部变量表，不能认为回退总有办法。混淆、编译设置和类文件可访问性也影响发现结果。

参考：[Java 17 Parameter 官方 API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/reflect/Parameter.html)。

## 8. 项目的参数名发现器做什么？

ExtParameterNameDiscoverer 扩展 DefaultParameterNameDiscoverer：

```java
super();
if (!NativeDetector.inNativeImage()) {
    addDiscoverer(new LocalVariableTableParameterNameDiscoverer());
}
```

先使用父类配置的发现方式，再追加本项目自定义的 LVT 回退。它不是拿不到名字就猜出源码，也不会重新读取 .java 文件补齐所有信息。

自定义 LVT 实现大体分四步：

1. 根据 Method 找声明类，按类缓存分析结果。
2. 读取 .class，使用 Spring ASM 遍历方法与局部变量。
3. 对应参数类型计算槽位，找出参数名称。
4. 把结果放回对应 Executable；没有信息时返回 null 等失败结果。

实例方法的第一个局部变量槽位通常留给 this，参数从后面开始；long、double 还涉及双槽位。源码中的 computeLvtSlotIndices 正是处理这些差异，不是无关的数组计算。

本阶段知道输入、输出与限制即可，不必一次理解所有 ASM visitor。

## 9. MethodBasedEvaluationContext：把参数放进表达式世界

项目为每个非空表达式创建：

```java
new MethodBasedEvaluationContext(null, method, parameterValues, nameDiscoverer);
```

四个参数分别是 rootObject、Method、实参数组和参数名发现器。当前 rootObject 传 null。

该上下文提供三类常见变量：

| 写法 | 含义 |
| --- | --- |
| #p0 | 第一个实参 |
| #a0 | 第一个实参的另一个索引别名 |
| #dto | 发现的形参名叫 dto 时，对应的实参 |

下标从 0 开始。#p0 / #a0 不要求知道源码中参数具体叫 dto，但仍依赖方法参数位置，重排签名时要重新核查。

参考：[MethodBasedEvaluationContext 官方 API](https://docs.spring.io/spring-framework/docs/6.2.x/javadoc-api/org/springframework/context/expression/MethodBasedEvaluationContext.html)。

## 10. 四种看起来相似的表达式

假设上下文有变量 dto，root 为 null：

| keys 中的单项 | 表达式含义 | 典型结果 |
| --- | --- | --- |
| "#dto.orderNumber" | 取变量 dto，再读属性 | 1001 |
| "#p0.orderNumber" | 取第一个实参，再读属性 | 1001 |
| "'all'" | 字符串常量 | all |
| "all" | 对当前求值对象访问名为 all 的属性 | 当前 root 为 null，可能求值错误 |

Java 外层双引号表示 Java 字符串；SpEL 里面的单引号表示表达式字符串常量。两层语言不要混淆。

### #all 不等于固定字符串 all

#all 查变量 all。如果方法没有这个变量名，通常得到 null；继续 #all.id 则可能在 null 上读属性而报错。

“找不到变量返回 null”与“读取 null 的属性失败”又是不同阶段，不能把二者都说成固定的一种异常。

参考：[Spring 官方 SpEL 变量说明](https://docs.spring.io/spring-framework/reference/core/expressions/language-ref/variables.html)。

## 11. 属性怎样读取？

对常见 Java DTO，SpEL 可以根据相应属性访问机制读 getter 等：

```java
public String getOrderNumber() {
    return orderNumber;
}
```

本课实验使用 public DTO 与 public getter，减少访问限制对主线的影响。不能认为 private 字段不需要任何访问机制就一定可读。

若 dto 是 Map，则要结合对应访问方式，常见显式索引形状为 `#dto['orderNumber']`；若参数是集合，取哪一项、按什么顺序转成字符串，都需要明确。

空对象、错误属性名与 getter 本身抛异常也可能让求值失败。能拿到 Method，不代表最终一定产生正确锁名。

## 12. 求值为 null 后，当前项目怎样做？

当前代码：

```java
Object objKey = parser.parseExpression(definitionKey).getValue(context);
definitionKeyList.add(ObjectUtils.nullSafeToString(objKey));
```

ObjectUtils.nullSafeToString(null) 返回文本 null，因此不存在的变量可能最终参与锁名：

```text
damai-SERVICE_LOCK:cancel:null
```

它不是“没有锁”，也不是自动生成随机唯一 key。多个不同请求可能因取值都为 null 而竞争同一个意外的 key。

相反，表达式求值抛异常时，这个方法没有在此捕获并返回默认 key，调用主线可能在实际获取锁之前就失败。

安全导航表达式可以在某些情况下把属性访问结果变为 null，但不会自动解决“null 能否成为业务锁维度”的问题。

## 13. 拼接规则：注解路径与手动路径不同

### 注解路径 getLockName

```text
服务前缀 + "-" + 处理器前缀 + ":" + name + ":" + 求值结果列表
```

ServiceLockInfoHandle 的处理器前缀是 SERVICE_LOCK；RepeatExecuteLimitLockInfoHandle 则是 REPEAT_EXECUTE_LIMIT。

### 手动路径 simpleGetLockName

```text
服务前缀 + "-LOCK_DISTRIBUTE_ID:" + name + ":" + 传入的普通 key 值列表
```

此路径不逐项调用 SpEL。传入 #dto.id 时，不能期待它自己去寻找 DTO。

因此同样 name=cancel、最后值=1001，两个路径可能得到：

```text
damai-SERVICE_LOCK:cancel:1001
damai-LOCK_DISTRIBUTE_ID:cancel:1001
```

不能默认注解方法和手动工具已经竞争同一把锁。读调用关系时先计算完整 key，再讨论互斥。

## 14. 两种“空”判断也不同

注解路径跳过表达式使用 ObjectUtils.isEmpty；手动路径过滤 key 使用项目 StringUtil.isNotEmpty。

对于 String，空字符串与 null 可以被前者跳过，但纯空白字符串不一定被当作空。后者还过滤纯空白、null / undefined 文本等。

所以不能简单说两条路径都会“自动清洗所有空值”。空表达式被跳过，与非空表达式求值为 null 后变成文本 null，也不是同一逻辑。

多个值用冒号直接拼接还要考虑歧义：例如值序列 a:b、c 与 a、b:c 都可能拼成 a:b:c。是否存在这类业务输入，应结合协议与锁粒度验证，不由分隔符自动保证唯一性。

## 15. 独立实验：编译元数据、SpEL 与锁名

实验使用真实 JDK 编译器、反射、Spring MethodBasedEvaluationContext，以及项目的 ExtParameterNameDiscoverer 和 LVT 发现器。

先确保本项目 common 模块的两个 parser 类在实验 classpath 中；可在 IDE 使用对应模块编译产物，也可以只将这两个原始源文件与本实验一起编译。还需匹配的 Spring Core、JCL、Context、Expression、Beans 等依赖。

主程序建议显式编译：

```text
javac --release 17 -parameters -cp "依赖classpath" ParameterSpelDemo.java
java -cp "编译输出目录与依赖classpath" ParameterSpelDemo
```

这里是参数形状示意，不是可以原样复制的完整依赖路径命令。主程序要求使用完整 JDK，因为会通过 JavaCompiler 动态编译三种样例，并在临时目录保存 .java/.class。

参数名实验会使用项目回退类，可能出现“使用调试信息回退”的日志，这是所读代码的行为，不代表实验断言失败。锁名函数只提取当前主线，不执行 AOP、Redis 或 SpringUtil 的真实环境读取。

```java
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import com.damai.parser.ExtParameterNameDiscoverer;
import org.springframework.context.expression.MethodBasedEvaluationContext;
import org.springframework.core.StandardReflectionParameterNameDiscoverer;
import org.springframework.expression.EvaluationContext;
import org.springframework.expression.spel.SpelEvaluationException;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.util.ObjectUtils;

public class ParameterSpelDemo {
    static final SpelExpressionParser PARSER = new SpelExpressionParser();

    public static class OrderDto {
        private final String orderNumber;
        public OrderDto(String orderNumber) { this.orderNumber = orderNumber; }
        public String getOrderNumber() { return orderNumber; }
    }

    public static class DemoService {
        public void cancel(OrderDto dto, String category) {}
    }

    static void inspect(String className, String... flags) throws Exception {
        Path dir = Files.createTempDirectory("redisson-parameter-");
        Path source = dir.resolve(className + ".java");
        Files.writeString(source, "public class " + className
                + " { public void process(String orderNumber) {} }", StandardCharsets.UTF_8);
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("需要完整JDK");
        List<String> options = new ArrayList<>(List.of("--release", "17", "-d", dir.toString()));
        options.addAll(Arrays.asList(flags));
        options.add(source.toString());
        if (compiler.run(null, null, null, options.toArray(String[]::new)) != 0) {
            throw new IllegalStateException("样例编译失败");
        }
        try (URLClassLoader loader = new URLClassLoader(new URL[]{dir.toUri().toURL()})) {
            Method method = loader.loadClass(className).getDeclaredMethod("process", String.class);
            System.out.println(className + " namePresent=" + method.getParameters()[0].isNamePresent());
            System.out.println(className + " reflection=" + Arrays.toString(
                    new StandardReflectionParameterNameDiscoverer().getParameterNames(method)));
            System.out.println(className + " extended=" + Arrays.toString(
                    new ExtParameterNameDiscoverer().getParameterNames(method)));
            if (className.equals("NoNames")) {
                EvaluationContext context = new MethodBasedEvaluationContext(null, method,
                        new Object[]{"1001"}, new StandardReflectionParameterNameDiscoverer());
                System.out.println("无名时#p0=" + PARSER.parseExpression("#p0").getValue(context));
                System.out.println("无名时#orderNumber=" + PARSER.parseExpression("#orderNumber").getValue(context));
            }
        }
    }

    static String annotatedKey(Method method, Object[] args, String... expressions) {
        List<String> parts = new ArrayList<>();
        for (String expression : expressions) {
            if (!ObjectUtils.isEmpty(expression)) {
                EvaluationContext context = new MethodBasedEvaluationContext(null, method, args,
                        new StandardReflectionParameterNameDiscoverer());
                Object value = PARSER.parseExpression(expression).getValue(context);
                parts.add(ObjectUtils.nullSafeToString(value));
            }
        }
        return "damai-SERVICE_LOCK:cancel:" + String.join(":", parts);
    }

    public static void main(String[] args) throws Exception {
        System.out.println("-- A: 三种编译信息 --");
        inspect("NamesKept", "-parameters", "-g:none");
        inspect("DebugOnly", "-g:vars");
        inspect("NoNames", "-g:none");

        System.out.println("-- B: 命名变量与索引别名 --");
        Method method = DemoService.class.getDeclaredMethod("cancel", OrderDto.class, String.class);
        if (!method.getParameters()[0].isNamePresent()) {
            throw new IllegalStateException("主程序请使用-parameters编译");
        }
        Object[] values = {new OrderDto("1001"), "vip"};
        EvaluationContext context = new MethodBasedEvaluationContext(null, method, values,
                new StandardReflectionParameterNameDiscoverer());
        for (String expression : List.of("#dto.orderNumber", "#p0.orderNumber", "#a1", "'all'")) {
            System.out.println(expression + "=" + PARSER.parseExpression(expression).getValue(context));
        }

        System.out.println("-- C: 缺失变量与普通属性 --");
        System.out.println("#missing=" + PARSER.parseExpression("#missing").getValue(context));
        try {
            PARSER.parseExpression("#missing.orderNumber").getValue(context);
        } catch (SpelEvaluationException error) {
            System.out.println("缺失变量再读属性=SpelEvaluationException");
        }
        try {
            PARSER.parseExpression("all").getValue(context);
        } catch (SpelEvaluationException error) {
            System.out.println("无引号all=SpelEvaluationException");
        }

        System.out.println("-- D: 两条锁名路径 --");
        String annotation = annotatedKey(method, values, "#dto.orderNumber");
        String manual = "damai-LOCK_DISTRIBUTE_ID:cancel:1001";
        System.out.println("注解key=" + annotation);
        System.out.println("手动key=" + manual);
        System.out.println("两者相等=" + annotation.equals(manual));
        System.out.println("缺失变量key=" + annotatedKey(method, values, "#missing"));
    }
}
```

预期标准输出，回退日志可能另外输出到错误流：

```text
-- A: 三种编译信息 --
NamesKept namePresent=true
NamesKept reflection=[orderNumber]
NamesKept extended=[orderNumber]
DebugOnly namePresent=false
DebugOnly reflection=null
DebugOnly extended=[orderNumber]
NoNames namePresent=false
NoNames reflection=null
NoNames extended=null
无名时#p0=1001
无名时#orderNumber=null
-- B: 命名变量与索引别名 --
#dto.orderNumber=1001
#p0.orderNumber=1001
#a1=vip
'all'=all
-- C: 缺失变量与普通属性 --
#missing=null
缺失变量再读属性=SpelEvaluationException
无引号all=SpelEvaluationException
-- D: 两条锁名路径 --
注解key=damai-SERVICE_LOCK:cancel:1001
手动key=damai-LOCK_DISTRIBUTE_ID:cancel:1001
两者相等=false
缺失变量key=damai-SERVICE_LOCK:cancel:null
```

本实验没有修改 Maven 编译参数或已有业务源码，也不证明全部项目类当前保留哪种元数据。实际业务类还要检查其真实编译产物。

验证记录：本地 JDK 25 使用 `javac --release 17 -parameters`，搭配 Spring 6.2.11，将本文程序与项目两个原始 parser 源文件一起编译运行。四组标准输出与讲义一致，实际观察到回退日志；没有连接 Redis 或运行完整业务工程。

## 16. 源码断点清单

| 位置 | 看什么 | 对应疑问 |
| --- | --- | --- |
| Aspect 进入后 | 注解 keys、目标类、实参数组 | 表达式与实际调用是否对应 |
| AbstractLockInfoHandle.getMethod | 签名方法与目标方法 | 是否成功切到实现类声明 |
| 参数名发现器返回处 | String[] 或 null | 命名变量能否建立 |
| new MethodBasedEvaluationContext | root、Method、args、discoverer | 索引和名字绑定在哪里 |
| getValue 前后 | 表达式文本、求值对象 | 是语法错误、变量缺失还是属性访问失败 |
| nullSafeToString 后 | 最终字符串 | null 是否已经变成文本 |
| getLockName 返回前 | 完整 key | 不同业务是否意外竞争或没有共同竞争 |

先把这张表用在一个真实 @ServiceLock 调用，再去细读 ASM，会更容易知道每个底层工具为什么存在。

## 17. 练习

1. 注解中出现 #，Java 编译器是否自动执行表达式？
2. Method 是否包含本次请求具体的订单号？
3. args[0] 是否天然知道源码形参叫 dto？
4. Parameter.getName 返回 arg0，能否说明已拿到真实参数名？
5. -parameters 与 -g:vars 是否同一类元数据？
6. 有局部变量表时，标准反射是否必然直接返回源码参数名？
7. 项目的 ExtParameterNameDiscoverer 能在所有元数据都缺失时猜出名字吗？
8. #p0 与 #dto 在依赖信息上有什么差别？
9. "'all'"、"all"、"#all" 三者是否相同？
10. root=null，直接表达式 dto.orderNumber 是否等于 #dto.orderNumber？
11. #missing 与 #missing.orderNumber 是否都必定抛同一种异常？
12. 求值返回 null 后，当前项目会自动拒绝生成锁名吗？
13. name 字段是否像 keys 一样逐项执行 SpEL？
14. 手动 simpleGetLockName 收到 #dto.id，会自动解析 DTO 吗？
15. 相同 name 与相同值，手动和注解路径是否必然同 key？
16. getDeclaredMethod 是否自动遍历全部父类 public 方法？
17. keys 为空字符串与非空表达式求值为 null，是同一条处理路径吗？
18. 两个不同值序列用冒号拼接，是否天然保证唯一？
19. long / double 与实例 this 为什么影响 LVT 参数槽位计算？
20. 本课实验通过，是否证明所有项目业务类的参数名都已保留？

## 18. 参考答案

### 1. 表达式由谁执行

不是 Java 编译器执行。注解保存字符串，项目运行时使用 SpEL parser 与上下文求值。

### 2. Method 与本次值

Method 描述方法，不保存每次调用的订单号。具体值来自 JoinPoint 的实参数组。

### 3. 位置与名字

args[0] 只表示第一个实参，要结合 Method 和参数名发现器建立命名变量；也可以使用位置别名。

### 4. arg0 与真实参数名

不能，arg0 可能是合成名。需要结合 isNamePresent 与实际发现器返回值判断。

### 5. 两种编译元数据

不同。-parameters 保留反射参数名所需信息，-g:vars 保留局部变量等调试信息，不能互相等同。

### 6. 标准反射与 LVT

不必然。普通 Parameter API 不自动把局部变量表当作源码参数名，需要相应解析器读取 class 信息。

### 7. 回退是否万能

不是。缺少相关 class、没有方法体信息或被剥除元数据时，回退可能返回 null。它不重新还原任意源码。

### 8. 索引与命名变量

#p0 按实参位置访问，#dto 依赖可发现的形参名。索引避免名称元数据依赖，但方法参数重排仍会影响含义。

### 9. 三种 all

不相同。带 SpEL 单引号的是字符串常量；无 #、无引号是当前对象的属性访问；#all 是变量读取，缺失时可能为 null。

### 10. root 与变量

不等同。项目 root 为 null，未带 # 的属性路径不会自动从命名变量 dto 起步，可能求值失败。

### 11. 缺失变量与属性链

不一定。单独读取未定义变量可能得到 null，再读 null 的属性则可能抛 SpelEvaluationException，应分阶段观察。

### 12. null 是否拒绝

当前没有在这里自动拒绝，nullSafeToString 会得到文本 null 并参与拼接，可能形成意外共享 key。

### 13. name 的处理

当前直接拼接 name，不在本方法中像 keys 一样逐项求值。需要按具体使用方法判断表达式支持。

### 14. 手动 key 是否求值

不会由 simpleGetLockName 自动执行 SpEL，它按普通 key 值过滤并拼接。

### 15. 两条路径能否天然互斥

不能。前缀与值处理不同，必须计算完整 key，再结合后端与锁类型分析。

### 16. 声明方法查找

不会自动遍历全部父类。getDeclaredMethod 关注当前类声明，继承查找需要相应 API 或明确逻辑。

### 17. 两种空结果

不同。空表达式可能在求值前跳过；非空表达式返回 null 则会被转成文本参与 key。

### 18. 分隔符与唯一性

不天然保证。值本身含分隔符时可能拼出相同文本，需结合编码、字段边界和业务约定评估。

### 19. 槽位为什么不同

实例方法通常先占用 this 槽位，long / double 使用双槽位，参数索引不总等于字节码局部变量槽位。

### 20. 实验与实际产物

没有证明。实验控制了样例编译选项；项目实际业务类需要检查真实编译配置、字节码、代理与发现路径。

## 19. 本课通关与下一课

任选一个 keys 表达式，指出它需要哪个 Method、哪个实参、怎样的参数名信息，算出最终完整 key；再分别尝试变量缺失、常量和手动路径，解释结果为什么不同。

下一课学习互斥、防重复与业务幂等，把“同一时刻不能一起执行”与“执行过的请求再次到来如何识别”区分开，为 RepeatExecuteLimitAspect 的源码做准备。

继续阅读：[第 06 课：互斥、防重复与业务幂等（含答案）](damai-redisson-framework-第06课-互斥防重复与幂等（含答案）.md)。
