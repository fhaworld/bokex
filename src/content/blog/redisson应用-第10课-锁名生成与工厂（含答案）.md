---
title: "redisson应用-第10课-锁名生成与工厂（含答案）"
description: "redisson应用系列第10课，主题：锁名生成与工厂（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 10 课：锁名生成与工厂（含答案）

前一课：[启动与公共底座](damai-redisson-framework-第09课-启动与公共底座（含答案）.md)。总进度见[课程导航](damai-redisson-framework-课程学习导航.md)。

本课沿当前工作区源码阅读。第 05 课已经讲过反射、参数名与 SpEL，本课把这些知识接成完整调用链：从业务参数到锁名，再看处理器工厂怎样选择实现。暂不进入底层加锁算法。

## 1. 本课目标：能手算并核验最终锁名

学完后，你应能回答：

1. 谁负责生成锁名，谁负责选择具体锁实现？
2. 同样的业务参数，注解与手动工具是否一定使用相同锁名？
3. 环境前缀、策略前缀、业务名、参数值分别从哪里来？
4. null、空字符串、参数顺序和分隔符如何影响结果？
5. 两个业务操作需要协调时，如何检查它们是否真的对准同一资源？

先记住：**锁名决定要协调哪个资源；锁类型和加锁方法决定怎样协调。** 不能只看到两处都写了“分布式锁”，就认定它们会互相阻塞。

## 2. 阅读地图：接口在 common，实现分属功能模块

| 文件 | 所在模块 | 本课关注点 |
| --- | --- | --- |
| [LockInfoHandle](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/lockinfo/LockInfoHandle.java) | common | 两个生成入口 |
| [AbstractLockInfoHandle](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/lockinfo/AbstractLockInfoHandle.java) | common | 方法定位、SpEL、字符串拼接 |
| [LockInfoHandleFactory](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/lockinfo/factory/LockInfoHandleFactory.java) | common | 按 Bean 名取得处理器 |
| [ServiceLockInfoHandle](../damai-redisson-framework/damai-redisson-service-framework/damai-service-lock-framework/src/main/java/com/damai/lockinfo/impl/ServiceLockInfoHandle.java) | service-lock | 提供 SERVICE_LOCK 前缀 |
| [RepeatExecuteLimitLockInfoHandle](../damai-redisson-framework/damai-redisson-service-framework/damai-repeat-execute-limit-framework/src/main/java/com/damai/lockinfo/impl/RepeatExecuteLimitLockInfoHandle.java) | repeat-execute-limit | 提供 REPEAT_EXECUTE_LIMIT 前缀 |
| [SpringUtil](../damai-common/src/main/java/com/damai/core/SpringUtil.java) | damai-common | 读取部署侧前缀 |

不要因为实现包名都叫 `com.damai.lockinfo.impl`，就认为它们都放在 common 模块。包名和 Maven 模块是两种组织关系。

## 3. 两个工厂先分清

```text
LockInfoHandleFactory
  输入：service_lock / repeat_execute_limit
  输出：LockInfoHandle
  作用：选锁名处理器

ServiceLockFactory
  输入：LockType，如 Reentrant / Fair / Read / Write
  输出：ServiceLocker
  作用：选具体锁操作封装
```

例如注解式业务锁的前半段：

```text
ServiceLockAspect
  → LockInfoHandleFactory.getLockInfoHandle(SERVICE_LOCK)
  → handle.getLockName(joinPoint, name, keys)
  → 得到字符串 lockName
  → ServiceLockFactory.getLock(lockType)
  → locker.tryLock(lockName, ...)
```

本课追到字符串生成；第 11 课再读 ServiceLocker 和四种实现。两类锁名处理器也不是“公平锁处理器”和“非公平锁处理器”，它们区分的是业务锁与防重复执行的命名空间。

## 4. `LockInfoHandle` 的两个入口

```java
String getLockName(JoinPoint joinPoint, String name, String[] keys);
String simpleGetLockName(String name, String[] keys);
```

| 入口 | keys 的含义 | 主要调用方 |
| --- | --- | --- |
| `getLockName` | SpEL 表达式数组，需要方法和实参上下文 | ServiceLockAspect、RepeatExecuteLimitAspect |
| `simpleGetLockName` | 已经计算好的普通字符串数组 | ServiceLockTool 的 execute、submit、部分 getLock 重载 |

手动路径传入 `"#p0"`，不会自动替换成第一个实参；它就是普通字符串。注解路径要写固定文本时，通常需要写成 SpEL 字符串字面量，例如 `"'fixed'"`。

`ServiceLockTool.getLock(lockType, lockName)` 这个直接接收完整锁名的重载会绕过锁名处理器。读调用点时必须先确认使用哪个重载。

## 5. 先手算注解路径的格式

`getLockName()` 的主体：

```java
return SpringUtil.getPrefixDistinctionName() + "-" + getLockPrefixName()
        + SEPARATOR + name + getRelKey(joinPoint, keys);
```

`SEPARATOR` 是 [Constants](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/core/Constants.java) 中的冒号 `":"`；`getRelKey()` 返回冒号加求值结果列表。

所以完整公式是：

```text
部署前缀 + "-" + 策略前缀 + ":" + 业务名 + ":" + 求值结果按冒号连接
```

假设：

```text
prefix.distinction.name = course10
处理器 = ServiceLockInfoHandle
name = cancel
keys = {"#request.orderNumber", "#region"}
request.orderNumber = "1001"
region = "cn"
```

结果：

```text
course10-SERVICE_LOCK:cancel:1001:cn
```

换成防重复处理器，同样的数据得到：

```text
course10-REPEAT_EXECUTE_LIMIT:cancel:1001:cn
```

两个子类只重写 `getLockPrefixName()`。具体锁类型、Java 类名、方法名、方法签名、返回值，都没有自动加入这条拼接公式。两个不同方法使用相同 name、求值结果和前缀时，会得到同一个名字；这可能是有意共享资源，也可能是误碰撞。

## 6. 部署前缀从哪里来

`SpringUtil.getPrefixDistinctionName()` 实际读取：

```java
configurableApplicationContext.getEnvironment().getProperty(
    PREFIX_DISTINCTION_NAME, DEFAULT_PREFIX_DISTINCTION_NAME);
```

两个常量来自 [Constant](../damai-common/src/main/java/com/damai/constant/Constant.java)：

```text
PREFIX_DISTINCTION_NAME = "prefix.distinction.name"
DEFAULT_PREFIX_DISTINCTION_NAME = "damai"
```

因此，它不自动等于 `spring.application.name`，也不自动等于 `spring.profiles.active`。是否区分开发、生产或租户，由实际配置决定。

需要共同协调的两个服务，前缀要按业务要求保持一致；本该隔离的部署若都使用默认前缀并共享 Redis，也可能意外共享资源名。还要核对连接的 Redis 实例、数据库、对象类型等，不能只比较一段字符串就宣布分布式协调一定成立。

SpringUtil 实现 `ApplicationContextInitializer`，通过 [damai-common 的 spring.factories](../damai-common/src/main/resources/META-INF/spring.factories) 注册。注意它使用的资源入口与上一课讲的自动配置 imports 不同。

这个静态工具需要先得到容器引用。直接在一个普通 main 中 new 处理器然后生成名字，如果没有初始化 SpringUtil，就可能因为静态容器字段为空而失败。本课实验会显式初始化真实 SpringUtil；它不验证完整 Boot 启动发现过程。

## 7. 从 JoinPoint 到 Method

`getRelKey()` 先调用私有 `getMethod(joinPoint)`：

```text
joinPoint.getSignature()
  → 转为 MethodSignature
  → signature.getMethod()
  → 若声明类是接口：
       target.getClass().getDeclaredMethod(同名, 同参数类型)
  → 返回 Method
```

这样做的目的，是在切点签名给出接口 Method 时，尝试使用实现类 Method 的元数据。接口与实现可以使用不同参数名；参数名发现影响 `#request` 这种表达式是否可用。

但是当前代码不是一个覆盖所有代理情形的通用方法解析器：

- `getDeclaredMethod()` 查当前类声明的方法，不会像 `getMethod()` 那样继续查找所有继承来的 public 方法。
- 接口分支查找失败会记录日志，然后保留原 Method；没有因此自动修复参数名或泛型桥接问题。
- 非接口 Method 不走这个替换分支，不能据此推导所有代理、继承和桥接方法都已处理。

所以，源码注释中的“真实方法”要结合这段具体算法理解。第 05 课的反射知识在这里变成了实际兼容范围。

## 8. SpEL 主线：表达式与结果都不能跳步

每条未被跳过的表达式都会执行：

```java
EvaluationContext context = new MethodBasedEvaluationContext(
        null, method, parameterValues, nameDiscoverer);
Object objKey = parser.parseExpression(definitionKey).getValue(context);
definitionKeyList.add(ObjectUtils.nullSafeToString(objKey));
```

把它读成四步：

1. 用 Method 与实参数组建立上下文，root 为 null。
2. 解析表达式。
3. 用当前上下文求值。
4. 将结果转换成字符串并按顺序收集。

`MethodBasedEvaluationContext` 提供 `#p0`、`#a0` 等位置别名，也可通过发现器提供真实参数名。参见 [Spring 官方 API](https://docs.spring.io/spring-framework/docs/6.2.x/javadoc-api/org/springframework/context/expression/MethodBasedEvaluationContext.html)。

当前 `ExtParameterNameDiscoverer` 在默认发现器之后追加项目 LVT 回退，实际效果取决于编译元数据与运行环境。`-parameters`、调试局部变量表与位置别名的区别见[第 05 课](damai-redisson-framework-第05课-注解反射与SpEL（含答案）.md)。

| 表达式 | 预期含义 | 注意点 |
| --- | --- | --- |
| `#request.orderNumber` | 命名参数的属性 | 需要能发现 request，且可读该属性 |
| `#p0.orderNumber` | 第一个参数的属性 | 改参数顺序也可能改变含义 |
| `#a1` | 第二个参数 | 要与实参位置对应 |
| `'fixed'` | 固定文本 fixed | 外层 Java 字符串写成 `"'fixed'"` |
| `#missing` | 未提供的变量 | 可能求值为 null，最终变成文本 null |
| `#missing.id` | 在缺失变量上读取属性 | 通常求值失败，不是自动补一个随机值 |

此处没有捕获 SpEL 解析或求值异常。异常会传播给调用方；正常切面主线中，锁名生成在 tryLock 之前，不能把表达式错误当成“没抢到锁”。

当前每条有效表达式都会创建一个上下文，并调用 parseExpression；没有在这一层看到跨调用的表达式缓存。它是实现观察，不是性能瓶颈已被测出的结论。

## 9. 两种“空”的处理不同

注解路径过滤的是**表达式定义**：

```java
if (!ObjectUtils.isEmpty(definitionKey)) {
    // 求值并转字符串
}
```

它跳过 null 和空字符串表达式。纯空白字符串不是这里的空字符串，不应当依靠它被自动过滤。

求值后的结果没有再执行同样的业务有效性检查：

| 表达式或结果 | 当前行为 |
| --- | --- |
| 表达式是 null 或 `""` | 跳过该表达式 |
| 表达式 `#request.optional` 求值为 null | 转成文本 `null`，加入结果 |
| 表达式 `"''"` 求值为空字符串 | 保留这个空结果 |
| 表达式 `"'null'"` | 结果也是文本 `null` |
| 表达式 `"' A '"` | 保留两侧空格 |

`ObjectUtils.nullSafeToString(null)` 返回文本 `"null"`，不是空串；参见 [ObjectUtils 官方 API](https://docs.spring.io/spring-framework/docs/6.2.x/javadoc-api/org/springframework/util/ObjectUtils.html#nullSafeToString(java.lang.Object))。

如果所有表达式都被跳过，`getRelKey()` 仍然补一个冒号，因此结果以冒号结尾：

```text
course10-SERVICE_LOCK:cancel:
```

这不是每次生成随机锁。许多缺少正确业务标识的请求，可能因此挤到同一个粗粒度资源名上。

## 10. 手动路径：固定前缀、普通值、更强的过滤

`simpleGetLockName()` 的核心：

```java
for (String key : keys) {
    if (StringUtil.isNotEmpty(key)) {
        definitionKeyList.add(key);
    }
}
return SpringUtil.getPrefixDistinctionName() + "-"
        + "LOCK_DISTRIBUTE_ID" + ":" + name + ":"
        + String.join(":", definitionKeyList);
```

这里没有调用子类的 `getLockPrefixName()`。所以，即使通过不同子类调用这个方法，只要其他输入相同，都会进入同一个 `LOCK_DISTRIBUTE_ID` 命名空间。

项目 [StringUtil.isNotEmpty](../damai-common/src/main/java/com/damai/util/StringUtil.java) 会过滤 null、空串、纯空白、忽略大小写及首尾空白后的 `null` / `undefined` 文本。但对合法值只判断，不做 trim 后再加入列表。

例如：

```text
keys = {null, "", " ", "null", "undefined", " A "}
结果（方括号只是展示边界）：
[course10-LOCK_DISTRIBUTE_ID:cancel: A ]
```

“空值被过滤”不代表输入一定合法。比如两个本来不同的参数组合，在过滤后可能得到相同序列。调用方应在需要时先完成业务校验。

## 11. 注解式与手动式：先比较完整字符串

同样的业务名与订单号：

```text
注解 getLockName：
course10-SERVICE_LOCK:cancel:1001

工具 simpleGetLockName：
course10-LOCK_DISTRIBUTE_ID:cancel:1001
```

它们的完整名字不同。因此不能假设两种 API 包住同一个业务就天然协同。

还要避免另一个误判：Read 与 Write 两种锁操作不一定应该拥有不同名字。读写锁通常需要指向同一读写锁资源，才能建立预期协调关系；当前 ServiceLockInfoHandle 不根据 Read/Write 切换前缀。具体对象如何取得，第 11 课验证。

比较资源时，至少写下四项：

| 检查项 | 要确认什么 |
| --- | --- |
| 部署连接 | 相应 Redis 实例、数据库与配置是否一致 |
| 完整锁名 | 前缀、业务名、结果值与顺序是否一致 |
| 对象与操作 | 普通锁、公平锁、读写锁及其调用是否按预期组合 |
| 业务路径 | 所有需要协调的修改是否真正经过加锁入口 |

本课只验证锁名计算，不验证两种锁类型混用是否安全，也不声称已经执行并发互斥测试。

## 12. 字符串拼接不天然无碰撞

当前使用冒号连接，未看到转义或长度编码。例如：

```text
keys = {"a:b", "c"}  → a:b:c
keys = {"a", "b:c"}  → a:b:c
```

两组不同业务标识得到同一后缀。name 与 key 的边界也有相似问题：name=`a:b`、key=`c`，与 name=`a`、key=`b:c` 可能相同。

反过来，参数顺序不同也会影响资源身份：`{"user1", "order1"}` 与 `{"order1", "user1"}` 通常不同。

设计或审阅锁名时，要先说明“哪些请求应该共享、哪些应该隔离”，再决定字段顺序、空值规则、规范化与编码方式。采用转义、长度编码或稳定序列化都是可考虑的方案，但修改现有规则还需分析旧实例共存与迁移，不能直接改名后假定所有节点仍在协调。

当前讲义不修改锁名规则或业务代码。

## 13. 工厂如何选中两个真实处理器

`LockInfoHandleFactory` 通过 Aware 回调得到容器，然后执行：

```java
applicationContext.getBean(lockInfoType, LockInfoHandle.class);
```

两个注册点分别是：

```text
ServiceLockAutoConfiguration：
  @Bean(LockInfoType.SERVICE_LOCK)
  → service_lock → ServiceLockInfoHandle

RepeatExecuteLimitAutoConfiguration：
  @Bean(LockInfoType.REPEAT_EXECUTE_LIMIT)
  → repeat_execute_limit → RepeatExecuteLimitLockInfoHandle
```

区分这两组文本：

| 用途 | 业务锁 | 防重复 |
| --- | --- | --- |
| Spring Bean 查询名 | `service_lock` | `repeat_execute_limit` |
| 注解路径锁名前缀 | `SERVICE_LOCK` | `REPEAT_EXECUTE_LIMIT` |

大小写差异不是拼写错误，它们用于不同位置。工厂不扫描注解、不解析 SpEL，也不在这里创建 RLock。

## 14. 六组实验：运行原始处理器，不连接 Redis

实验编译项目原始类，包括 AbstractLockInfoHandle、两个真实子类、工厂、SpringUtil、常量、StringUtil 与参数名发现器。使用真实 Spring 容器完成工厂的 Aware 回调。

为了只验证命名，实验用 JDK 动态代理提供最小 JoinPoint / MethodSignature 数据，**没有建立 Spring AOP 业务代理，也没有执行业务方法或获取 Redis 锁**。接口 Method 被替换成实现类 Method 的逻辑，则由项目原方法实际执行。

保存为 `LockNameSourceDemo.java`：

```java
import com.damai.constant.LockInfoType;
import com.damai.core.SpringUtil;
import com.damai.lockinfo.LockInfoHandle;
import com.damai.lockinfo.factory.LockInfoHandleFactory;
import com.damai.lockinfo.impl.RepeatExecuteLimitLockInfoHandle;
import com.damai.lockinfo.impl.ServiceLockInfoHandle;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.expression.spel.SpelEvaluationException;

public class LockNameSourceDemo {
    public static class Request {
        public String getOrderNumber() { return "1001"; }
        public String getOptional() { return null; }
    }

    public interface OrderApi {
        void cancel(Request input, String zone);
    }

    public static class OrderService implements OrderApi {
        public void cancel(Request request, String region) {
            throw new AssertionError("本实验不应执行业务方法");
        }
    }

    static JoinPoint point(Object target, Method method, Object[] args) {
        MethodSignature signature = (MethodSignature) Proxy.newProxyInstance(
                LockNameSourceDemo.class.getClassLoader(),
                new Class<?>[]{MethodSignature.class}, (proxy, invoked, values) -> {
                    return switch (invoked.getName()) {
                        case "getMethod" -> method;
                        case "getName" -> method.getName();
                        default -> throw new UnsupportedOperationException(invoked.getName());
                    };
                });
        return (JoinPoint) Proxy.newProxyInstance(
                LockNameSourceDemo.class.getClassLoader(),
                new Class<?>[]{JoinPoint.class}, (proxy, invoked, values) -> {
                    return switch (invoked.getName()) {
                        case "getSignature" -> signature;
                        case "getTarget" -> target;
                        case "getArgs" -> args;
                        default -> throw new UnsupportedOperationException(invoked.getName());
                    };
                });
    }

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    static void expect(Class<? extends Throwable> type, Runnable action) {
        try {
            action.run();
        } catch (Throwable error) {
            if (type.isInstance(error)) return;
            throw new AssertionError("异常类型不符", error);
        }
        throw new AssertionError("没有抛出预期异常：" + type.getName());
    }

    public static void main(String[] args) throws Exception {
        try (var context = new AnnotationConfigApplicationContext()) {
            Map<String, Object> properties = new HashMap<>();
            properties.put("prefix.distinction.name", "course10");
            context.getEnvironment().getPropertySources()
                    .addFirst(new MapPropertySource("demo", properties));
            new SpringUtil().initialize(context);
            context.registerBean(LockInfoType.SERVICE_LOCK, ServiceLockInfoHandle.class);
            context.registerBean(LockInfoType.REPEAT_EXECUTE_LIMIT,
                    RepeatExecuteLimitLockInfoHandle.class);
            context.registerBean(LockInfoHandleFactory.class);
            context.refresh();

            var factory = context.getBean(LockInfoHandleFactory.class);
            LockInfoHandle service = factory.getLockInfoHandle(LockInfoType.SERVICE_LOCK);
            LockInfoHandle repeat = factory.getLockInfoHandle(LockInfoType.REPEAT_EXECUTE_LIMIT);
            Method apiMethod = OrderApi.class.getMethod("cancel", Request.class, String.class);
            JoinPoint jp = point(new OrderService(), apiMethod,
                    new Object[]{new Request(), "cn"});

            // A：接口参数名为 input/zone，实现参数名为 request/region。
            String s = service.getLockName(jp, "cancel",
                    new String[]{"#request.orderNumber", "#region"});
            String r = repeat.getLockName(jp, "cancel",
                    new String[]{"#p0.orderNumber", "#a1"});
            check(s.equals("course10-SERVICE_LOCK:cancel:1001:cn"), "业务锁名错误");
            check(r.equals("course10-REPEAT_EXECUTE_LIMIT:cancel:1001:cn"), "防重复锁名错误");
            System.out.println("A " + s);
            System.out.println("A " + r);

            // B：跳过空定义，保留 null 求值；普通路径使用另一套过滤。
            String empty = service.getLockName(jp, "empty", new String[]{null, ""});
            String nullValue = service.getLockName(jp, "nullable",
                    new String[]{"#request.optional"});
            String filtered = service.simpleGetLockName("filter",
                    new String[]{null, "", " ", "null", "undefined", " A "});
            check(empty.equals("course10-SERVICE_LOCK:empty:"), "尾部冒号错误");
            check(nullValue.endsWith(":null"), "null应保留为文本");
            check(filtered.equals("course10-LOCK_DISTRIBUTE_ID:filter: A "), "过滤结果错误");
            System.out.println("B 空表达式列表=[" + empty + "]");
            System.out.println("B null求值=[" + nullValue + "]");
            System.out.println("B 普通值过滤=[" + filtered + "]");

            // C：simple 不求值，不使用子类前缀；与注解入口不同名。
            String plain = service.simpleGetLockName("cancel", new String[]{"#p0", "1001"});
            check(plain.equals("course10-LOCK_DISTRIBUTE_ID:cancel:#p0:1001"), "不应解析SpEL");
            boolean sameSimple = plain.equals(repeat.simpleGetLockName("cancel",
                    new String[]{"#p0", "1001"}));
            boolean annotationEqualsTool = service.getLockName(jp, "cancel",
                    new String[]{"#p0.orderNumber"}).equals(
                    service.simpleGetLockName("cancel", new String[]{"1001"}));
            check(sameSimple && !annotationEqualsTool, "前缀差异错误");
            System.out.println("C " + plain);
            System.out.println("C 两子类simple同名=" + sameSimple
                    + "，注解与工具同名=" + annotationEqualsTool);

            // D：连接未转义，两个不同元组碰撞；顺序也影响结果。
            String left = service.getLockName(jp, "tuple", new String[]{"'a:b'", "'c'"});
            String right = service.getLockName(jp, "tuple", new String[]{"'a'", "'b:c'"});
            boolean collision = left.equals(right);
            boolean orderChanged = !service.simpleGetLockName("tuple", new String[]{"u", "o"})
                    .equals(service.simpleGetLockName("tuple", new String[]{"o", "u"}));
            check(collision && orderChanged, "元组拼接行为错误");
            System.out.println("D 不同元组碰撞=" + collision + "，调换顺序改变锁名=" + orderChanged);

            // E：同一处理器每次从环境读取前缀。
            properties.put("prefix.distinction.name", "prod");
            String prod = service.getLockName(jp, "cancel", new String[]{"#p0.orderNumber"});
            check(prod.equals("prod-SERVICE_LOCK:cancel:1001"), "环境前缀未变化");
            System.out.println("E " + prod);
            properties.put("prefix.distinction.name", "course10");

            // F：求值错误和数组本身为null，不会生成正常锁名。
            expect(SpelEvaluationException.class, () -> service.getLockName(jp, "bad",
                    new String[]{"#missing.id"}));
            expect(NullPointerException.class, () -> service.getLockName(jp, "bad", null));
            expect(NullPointerException.class, () -> service.simpleGetLockName("bad", null));
            System.out.println("F 缺失变量属性访问报错=true，两个入口null数组报错=true");
        }
    }
}
```

预期标准输出：

```text
A course10-SERVICE_LOCK:cancel:1001:cn
A course10-REPEAT_EXECUTE_LIMIT:cancel:1001:cn
B 空表达式列表=[course10-SERVICE_LOCK:empty:]
B null求值=[course10-SERVICE_LOCK:nullable:null]
B 普通值过滤=[course10-LOCK_DISTRIBUTE_ID:filter: A ]
C course10-LOCK_DISTRIBUTE_ID:cancel:#p0:1001
C 两子类simple同名=true，注解与工具同名=false
D 不同元组碰撞=true，调换顺序改变锁名=true
E prod-SERVICE_LOCK:cancel:1001
F 缺失变量属性访问报错=true，两个入口null数组报错=true
```

E 修改的是独立实验容器中的属性源，用来证明该方法每次读取环境；这不表示生产配置中心更新一定会自动推送到 Environment，也不建议在线随意切换锁命名空间。

### 编译运行（PowerShell）

在仓库根目录执行，将 `$demoDir` 设为保存上述 Java 文件的临时目录。本机验证使用 Spring **6.2.11**，属于独立实验依赖；项目根 POM 的 Boot **3.3.0** 没有被改动。此实验不需要 Boot jar 或 Redisson jar。

```powershell
$repo = (Get-Location).Path
$m2 = Join-Path $env:USERPROFILE '.m2/repository'
$jarPaths = @(
  'org/springframework/spring-context/6.2.11/spring-context-6.2.11.jar'
  'org/springframework/spring-core/6.2.11/spring-core-6.2.11.jar'
  'org/springframework/spring-beans/6.2.11/spring-beans-6.2.11.jar'
  'org/springframework/spring-expression/6.2.11/spring-expression-6.2.11.jar'
  'org/springframework/spring-aop/6.2.11/spring-aop-6.2.11.jar'
  'org/springframework/spring-jcl/6.2.11/spring-jcl-6.2.11.jar'
  'org/aspectj/aspectjweaver/1.9.24/aspectjweaver-1.9.24.jar'
  'org/slf4j/slf4j-api/2.0.17/slf4j-api-2.0.17.jar'
  'org/projectlombok/lombok/1.18.44/lombok-1.18.44.jar'
)
$jars = @($jarPaths | ForEach-Object { Join-Path $m2 $_ })
foreach ($jar in $jars) {
  if (-not (Test-Path -LiteralPath $jar)) { throw "缺少实验依赖：$jar" }
}
$cp = $jars -join [IO.Path]::PathSeparator
$redissonSource = Join-Path $repo 'damai-redisson-framework/damai-redisson-service-framework'
$commonSource = Join-Path $redissonSource 'damai-redisson-common-framework/src/main/java/com/damai'
$baseSource = Join-Path $repo 'damai-common/src/main/java/com/damai'
$sources = @(
  (Join-Path $baseSource 'core/SpringUtil.java')
  (Join-Path $baseSource 'constant/Constant.java')
  (Join-Path $baseSource 'util/StringUtil.java')
  (Join-Path $commonSource 'core/Constants.java')
  (Join-Path $commonSource 'constant/LockInfoType.java')
  (Join-Path $commonSource 'parser/ExtParameterNameDiscoverer.java')
  (Join-Path $commonSource 'parser/LocalVariableTableParameterNameDiscoverer.java')
  (Join-Path $commonSource 'lockinfo/LockInfoHandle.java')
  (Join-Path $commonSource 'lockinfo/AbstractLockInfoHandle.java')
  (Join-Path $commonSource 'lockinfo/factory/LockInfoHandleFactory.java')
  (Join-Path $redissonSource 'damai-service-lock-framework/src/main/java/com/damai/lockinfo/impl/ServiceLockInfoHandle.java')
  (Join-Path $redissonSource 'damai-repeat-execute-limit-framework/src/main/java/com/damai/lockinfo/impl/RepeatExecuteLimitLockInfoHandle.java')
  (Join-Path $demoDir 'LockNameSourceDemo.java')
)
$classes = Join-Path $demoDir 'classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
javac --release 17 -parameters -encoding UTF-8 -cp $cp -processorpath $jars[-1] -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw '编译失败' }
$runCp = $classes + [IO.Path]::PathSeparator + $cp
java '-Dstdout.encoding=UTF-8' -cp $runCp LockNameSourceDemo
if ($LASTEXITCODE -ne 0) { throw '实验失败' }
```

本例显式使用 `-parameters`，A 组才能可靠验证实现方法的命名参数。它不检查生产业务类的真实编译产物；LVT 回退也不是本课新增验证目标。

验证记录（2026-11-03）：从本文提取完整 Java 示例与 PowerShell 脚本，使用 OpenJDK 25.0.2、`javac --release 17 -parameters` 和上列依赖，将 12 个项目原始源文件与示例一起编译运行。六组标准输出与预期逐行一致。诊断输出包含 Lombok 使用 Unsafe 的弃用提示及 SLF4J 未配置 provider 的提示，不影响本例断言。课程本地链接和代码围栏检查通过；未修改项目业务代码或 POM，未运行 Redis、业务 AOP 或跨服务集成测试。

## 15. 回到真实业务调用点

打开 [UserService](../damai-server/damai-user-service/src/main/java/com/damai/service/UserService.java)，查注册与手机号检查方法。当前分别使用 Write 和 Read 类型，但业务名均为 `REGISTER_USER_LOCK`，keys 分别取对应 DTO 的 mobile。

要判断这两处是否在协调同一手机号，依次检查：常量值相同、实际手机号字符串相同、部署前缀及连接一致，再进入下一课核对读写锁对象。

再打开 [OrderService](../damai-server/damai-order-service/src/main/java/com/damai/service/OrderService.java)，看取消订单附近的两个注解：

```text
@RepeatExecuteLimit(name = CANCEL_PROGRAM_ORDER, keys = 订单号表达式)
@ServiceLock(name = UPDATE_ORDER_STATUS_LOCK, keys = 订单号表达式)
```

即使订单号相同，策略前缀与业务名也不同，不应将二者视为同一个名字。锁名分析只说明资源命名，切面的执行顺序、重复标记和锁生命周期将在第 12、13 课继续阅读。

## 16. 源码阅读练习

对一个具体调用点，填写下表。优先抄实际值，避免写“订单锁”这样的笼统描述。

| 字段 | 你的记录 |
| --- | --- |
| 调用入口与重载 | 注解 getLockName / 工具 simple / 直接完整名 |
| 处理器 Bean 查询名 | service_lock 或 repeat_execute_limit |
| Method 来源 | 切点签名、是否成功替换成实现方法 |
| 表达式数组或普通值数组 | 按原顺序记录 |
| 实际求值结果 | 区分 null、空串和文本 null |
| 部署前缀与业务名 | 明确配置及常量值 |
| 完整锁名 | 手算后用断点或独立实验核对 |
| 预期共享对象 | 哪些请求应相同，哪些必须不同 |

至少为“同订单相同参数”“不同订单”“空订单号”“包含冒号”各填一次。输入能拼成字符串，并不说明它是有效的业务身份。

## 17. 自测题

1. LockInfoHandleFactory 与 ServiceLockFactory 分别选什么？
2. 两个真实处理器实现都位于 common 模块吗？
3. getLockName 与 simpleGetLockName 的 keys 含义有何不同？
4. 部署前缀从哪个配置项读取，默认值是什么？
5. 前缀是否自动等于 spring.application.name？
6. prefix=demo、业务锁、name=pay、订单号=88，注解式完整名字是什么？
7. 同一输入改用防重复处理器，注解式前缀怎样变？
8. 两子类调用 simpleGetLockName，是否仍分别使用自己的策略前缀？
9. 同 name、同普通值，工具和注解一定共用一个名字吗？
10. 当前公式会自动包含 Java 类名、方法名或 LockType 吗？
11. 接口 Method 如何尝试替换成实现 Method，有什么继承边界？
12. `#p0`、`#a0` 与 `#request` 有什么不同？
13. 注解中的固定字符串应怎样写，手动路径中的 `#p0` 会怎样？
14. 求值为 null 后会被自动跳过吗？
15. 所有表达式均被跳过后，名字是否仍带尾部冒号？
16. simple 路径中的 `" A "` 会被 trim 后再拼接吗？
17. `{a:b,c}` 与 `{a,b:c}` 为什么可能同名？
18. Bean 查询名 service_lock 与字符串前缀 SERVICE_LOCK 是同一用途吗？
19. 表达式求值失败是否等同于 tryLock 返回 false？
20. 本课实验是否验证了真实 AOP、Redis 并发锁和生产编译参数？

## 18. 参考答案

### 1. 两个工厂

前者选择锁名处理器；后者按 LockType 选择具体 ServiceLocker 封装。一个处理资源身份，一个处理锁操作类型。

### 2. 模块位置

不是。抽象、接口和工厂在 common，业务锁实现位于 service-lock，防重复实现位于 repeat-execute-limit。

### 3. 两个入口

getLockName 将 keys 当 SpEL，结合切点求值；simpleGetLockName 接收已经得到的字符串，不解析 SpEL。

### 4. 前缀来源

prefix.distinction.name，缺省为 damai，由 SpringUtil 从 Environment 读取。

### 5. 应用名称

不自动相等。需要检查实际配置，不能从“服务区分名”的注释推断它自动包含环境或服务名。

### 6. 业务锁名

`demo-SERVICE_LOCK:pay:88`，假设表达式只产生这一个订单号结果。

### 7. 防重复锁名

`demo-REPEAT_EXECUTE_LIMIT:pay:88`。更换的是命名策略前缀，不能因此推导业务幂等已经实现。

### 8. simple 前缀

都固定使用 LOCK_DISTRIBUTE_ID，没有调用子类的 getLockPrefixName()。

### 9. 工具与注解

不一定，当前普通工具路径与注解路径前缀不同；相同 name 和参数不足以得到同一个完整名字。

### 10. 自动字段

都不会自动包含。若希望把某字段纳入身份，要由规则明确表达；不能凭方法位置推断它已入锁名。

### 11. Method 替换

接口分支用目标类 getDeclaredMethod 查同名同参数方法，失败后日志并保留原 Method。它不搜索所有父类声明，也没有完整处理所有代理与桥接情形。

### 12. 参数引用

p0/a0 是位置别名；request 是发现到的参数名。位置别名不依赖该真实名称，但仍依赖正确的参数位置与对象结构。

### 13. 固定与普通文本

注解 Java 字符串可写 `"'fixed'"`，让 SpEL 得到 fixed；simple 路径的 `"#p0"` 直接参与拼接。

### 14. null 结果

不会在求值后被过滤，而是经 nullSafeToString 变成文本 null。它与表达式定义为 null 被跳过不同。

### 15. 空后缀

是，getRelKey 仍返回冒号加空连接结果；许多缺少标识的请求可能共用这个意外的名字。

### 16. 空格

不 trim 后再加入。StringUtil 判断时使用 trim，但合法值仍按原字符串保留，因此两侧空格影响最终名字。

### 17. 分隔符碰撞

未转义地按冒号连接，字段边界丢失，两组值都得到 a:b:c。业务名含冒号也可能引入类似碰撞。

### 18. 两种字符串

前者是 Spring Bean 查询名，后者是注解路径生成名字时使用的策略前缀，用途与大小写不同。

### 19. 异常与抢锁失败

不同。解析或求值异常会从命名方法传播，当前切面主线尚未调用 tryLock，不能进入正常的抢锁超时解释。

### 20. 实验范围

没有。验证的是原始命名类、工厂的 Spring 回调、受控 JoinPoint 数据与 SpEL 结果。未建立业务 AOP 代理、未连接 Redis，也未检查生产业务类元数据或跨服务互斥行为。

## 19. 本课通关与下一课

给定部署前缀、处理器、业务名、表达式与实参，能手算完整锁名；能解释注解与工具为什么可能不同名，以及哪些输入会造成意外共享或意外隔离。

下一课学习“锁接口、四种实现与选择工厂”，继续追踪 ServiceLocker、ManageLocker 和 ServiceLockFactory，核对可重入、公平、读锁、写锁的真实 API 调用及等待与租期语义。
