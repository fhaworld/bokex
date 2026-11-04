---
title: "redisson应用-第09课-启动与公共底座（含答案）"
description: "redisson应用系列第09课，主题：启动与公共底座（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 09 课：启动与公共底座（含答案）

从本课开始正式沿项目源码学习。已有基础：Java、Stream、Spring Boot，以及前八课的锁、AOP、Redis、布隆与队列知识。

前一课：[延迟队列与消费基础](damai-redisson-framework-第08课-延迟队列与消费基础（含答案）.md)。总进度见[课程导航](damai-redisson-framework-课程学习导航.md)。

## 1. 本课目标：找到业务代码背后的对象来源

看到业务类里注入 `ServiceLockTool`、`RedissonDataHandle` 或 `DelayQueueContext`，先不要急着进入加锁或消费方法。本课回答：

1. 这些类来自哪个 Maven 模块？
2. 配置类为什么会进入 Spring 容器？
3. 配置数据绑定到哪个对象？
4. 谁创建 RedissonClient，其他模块怎样取得它？
5. 启动失败时，怎样区分装配、配置和连接问题？

本课阅读的是当前工作区源码。根 POM 声明 Spring Boot **3.3.0**、Redisson **3.32.0**；实际运行版本仍要以有效依赖树和运行 classpath 为准，不能把本机缓存或最新官网版本当成项目版本。

## 2. 第一步：先区分模块聚合与依赖

打开 [Redisson 顶层 POM](../damai-redisson-framework/pom.xml)，再打开 [服务工具聚合 POM](../damai-redisson-framework/damai-redisson-service-framework/pom.xml)。

```text
damai-redisson-framework                     packaging=pom
├─ damai-service-delay-queue-framework        延迟队列
└─ damai-redisson-service-framework           packaging=pom
   ├─ damai-redisson-common-framework         公共配置与基础工具
   ├─ damai-service-lock-framework            分布式锁封装
   ├─ damai-repeat-execute-limit-framework    防重复执行
   └─ damai-bloom-filter-framework            布隆过滤器
```

`<modules>` 声明一起组织构建哪些项目；`<dependencies>` 声明当前模块需要哪些依赖。**同一个父模块下的兄弟模块，不会仅因为列在 modules 中就自动互相依赖。** `dependencyManagement` 管理依赖版本等信息，也不等于已经引入依赖。

再核对各子模块 POM，得到主要依赖方向：

```text
防重复模块 ──→ 锁模块 ──→ common
    └─────────────────→ common
布隆模块 ─────────────→ common
延迟队列模块 ─────────→ common
common ──→ Redisson starter、Spring Data Redis、AOP、Caffeine 等
```

因此，应用引入某个功能模块，可能传递获得 common 与 starter。排查时应看最终应用的依赖树，不能把上面的目录树直接当成运行时 classpath。

## 3. 第二步：找真正的自动配置入口

在各模块 `src/main/resources` 搜索这个文件：

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

本项目五个文件各列出一个类：

| 所在模块 | imports 中的全限定类名 |
| --- | --- |
| common | `com.damai.config.RedissonCommonAutoConfiguration` |
| service-lock | `com.damai.config.ServiceLockAutoConfiguration` |
| repeat-execute-limit | `com.damai.config.RepeatExecuteLimitAutoConfiguration` |
| bloom-filter | `com.damai.config.BloomFilterAutoConfiguration` |
| delay-queue | `com.damai.config.DelayQueueAutoConfig` |

Spring Boot 自动配置机制启用后，会从 classpath 中读取这类候选清单，结合排除、条件与排序处理配置。文件必须真正进入构建产物；仅存在于源码目录，不代表最终应用一定能加载。

本项目这些配置类没有统一标注 `@AutoConfiguration`，有的也没有显式 `@Configuration`。不要因此断言它们完全无法生效：它们被列入 imports，作为导入的配置候选处理，类中的 `@Bean` 等配置元数据仍能参与解析。也不能反过来说“只要命名为 AutoConfiguration 就会自动装配”。

Spring Boot 推荐的新自动配置写法使用 `@AutoConfiguration`，候选发现依赖上述 imports 文件。排序约束影响 Bean 定义的处理顺序，Bean 实际创建还取决于依赖关系。参见 [Spring Boot 3.3 自动配置开发文档](https://docs.spring.io/spring-boot/3.3/reference/features/developing-auto-configuration.html)。

本课实验会显式注册少量配置，验证绑定与生命周期；它不验证 Boot 自动发现全部 imports 的过程。这两种验证要分开说清。

## 4. 第三步：打开公共配置类，先列 Bean 清单

源码：[RedissonCommonAutoConfiguration](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/config/RedissonCommonAutoConfiguration.java)。

先折叠方法体，只看入口：

```java
@AutoConfigureBefore(value = {
    RedissonAutoConfigurationV2.class,
    RedissonAutoConfiguration.class
})
@EnableConfigurationProperties(RedissonBaseProperties.class)
public class RedissonCommonAutoConfiguration {
    // @Bean 方法……
}
```

再抄出四个方法：

| Bean 方法 | 返回类型 | 直接依赖 |
| --- | --- | --- |
| `redissonClient(...)` | `RedissonClient` | `RedisProperties`、`RedissonBaseProperties` |
| `redissonDataHandle(...)` | `RedissonDataHandle` | `RedissonClient` |
| `localLockCache()` | `LocalLockCache` | 方法无参数，字段与初始化阶段另有依赖 |
| `lockInfoHandleFactory()` | `LockInfoHandleFactory` | 方法无参数，后续需要容器回调 |

没有显式指定 Bean 名时，通常以方法名作为 Bean 名。方法参数由 Spring 解析依赖，源码里无需自己先调用 `redissonClient()` 再手动传给每个功能模块。

本项目主要用方法参数表达依赖，这也避免把配置类中普通 Java 方法互调误认为一定经过 Bean 代理。

## 5. 两种属性对象：前缀不要写混

| 对象 | 绑定前缀 | 用途 |
| --- | --- | --- |
| Spring Boot `RedisProperties` | `spring.data.redis` | 主机、端口、密码、库号等标准 Redis 属性 |
| 项目 `RedissonBaseProperties` | `spring.redis.redisson` | Redisson 线程数与可选执行器参数 |

第二行前缀来自项目类注解，并没有跟随第一行迁移成 `spring.data.redis.redisson`。

源码：[RedissonBaseProperties](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/config/RedissonBaseProperties.java)。Spring Boot 3.3.0 的标准前缀可核对 [RedisProperties 原始源码](https://github.com/spring-projects/spring-boot/blob/v3.3.0/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/data/redis/RedisProperties.java)。

例如下面是两组不同用途的配置，地址与数值均为教学示例：

```yaml
spring:
  data:
    redis:
      host: 127.0.0.1
      port: 6379
      database: 0
  redis:
    redisson:
      threads: 8
      netty-threads: 16
      core-pool-size: 2
      maximum-pool-size: 4
      work-queue-size: 128
```

`@ConfigurationProperties` 描述绑定规则，`@EnableConfigurationProperties(RedissonBaseProperties.class)` 将对应属性类注册并启用绑定。当前 common 配置类只显式启用自定义属性类；标准 `RedisProperties` 还需要相关 Boot/starter 配置路径提供，不能假设任意手工构造的容器里都已存在。

属性类上的 Lombok `@Data` 在当前代码中生成 getter/setter 等方法。它是一种实现方式；手写访问器也可以满足绑定要求，不能把 Lombok 注解本身当成 Spring 的强制要求。

## 6. 逐段读 `redissonClient(...)`

### 6.1 先创建客户端配置对象

```java
Config config = new Config();
String prefix = "redis://";
```

这里的 `Config` 是 Redisson 配置对象，不是 Spring 配置类，也不是已经连接成功的客户端。

### 6.2 SSL 反射判断：兼容意图与实际覆盖范围

```java
Method method = ReflectionUtils.findMethod(RedisProperties.class, "isSsl");
if (method != null && (Boolean) ReflectionUtils.invokeMethod(method, redisProperties)) {
    prefix = "rediss://";
}
```

判断有两步：先找到无参 `isSsl()`，再调用并检查结果。找不到方法时不会进入分支，协议保持 `redis://`。

但项目声明的 Boot 3.3.0 中，标准属性类使用 `getSsl().isEnabled()`，没有旧的顶层 `isSsl()`。所以，**仅在配置中设置 `spring.data.redis.ssl.enabled=true`，当前这段代码仍不会据此切换成 `rediss://`**。这是对指定版本源码与当前分支的静态结论，不是已经执行了 TLS 连接实验。

反射让“没有这个旧方法”时不直接调用失败，并不意味着自动支持所有新版本的 SSL 配置。第 18 课还会复盘这一兼容边界。

### 6.3 当前固定走单节点配置

```java
config.useSingleServer()
    .setAddress(prefix + redisProperties.getHost() + ":" + redisProperties.getPort())
    .setConnectTimeout(1000)
    .setDatabase(redisProperties.getDatabase())
    .setPassword(redisProperties.getPassword());
```

请逐项标注“来源”：

| 最终设置 | 当前值来自哪里 |
| --- | --- |
| 地址 | 协议前缀 + host + port |
| 连接超时 | 代码固定 1000 毫秒 |
| 数据库编号 | `RedisProperties.database` |
| 密码 | `RedisProperties.password` |
| 模式 | 代码固定 `useSingleServer()` |

没有看到根据 sentinel 或 cluster 属性切换分支。也没有把 username、url、标准 connectTimeout、标准 timeout 等所有属性逐一映射进去。

因此，属性成功绑定和客户端实际使用是两回事。例如将标准 `connect-timeout` 改为 5 秒，不会覆盖此处硬编码的 1000 毫秒。也不能把“支持注入 RedisProperties”理解成“支持该类所有功能”。

### 6.4 Redisson 线程参数与可选执行器

```java
config.setThreads(redissonBaseProperties.getThreads());
config.setNettyThreads(redissonBaseProperties.getNettyThreads());
```

当前默认 threads=16、nettyThreads=32。它们与第 08 课延迟消费者的业务线程池是不同的配置入口；调整一个不等于调整全部线程池。

接着检查：

```java
if (Objects.nonNull(redissonBaseProperties.getCorePoolSize()) &&
    Objects.nonNull(redissonBaseProperties.getMaximumPoolSize())) {
    // 构造有界 ThreadPoolExecutor，再 config.setExecutor(...)
}
```

两个包装类型属性默认都是 null。只有两项都非 null 才走自定义执行器分支。

| corePoolSize | maximumPoolSize | 进入自定义分支？ |
| --- | --- | --- |
| null | null | 否 |
| 2 | null | 否 |
| null | 4 | 否 |
| 2 | 4 | 是 |

“非 null”不等于“合法”。例如 core=4、max=2，线程池构造器会拒绝这种参数；容量小于等于 0 也会产生错误。当前属性类没有展示相应 Bean Validation 注解，源码审阅时要另外检查参数合法性。

### 6.5 最后才创建 RedissonClient

```java
return Redisson.create(config);
```

这不是仅创建一个无副作用的数据 DTO。真实启动应考虑客户端初始化及连接相关失败。排查时，已经进入该方法但在这里失败，与配置类根本没有被加载是两种情况。

当前本地没有执行真实 Redis 启动验证，因此不把本课实验结果写成“整个应用已经连接成功”。

## 7. 与官方 starter 的关系：排序和退让一起看

项目 common 配置声明在官方两个自动配置类之前处理。Redisson 3.32.0 官方创建客户端的方法带 `@ConditionalOnMissingBean(RedissonClient.class)`：已有客户端定义时，该方法应退让。核对 [Redisson 3.32.0 官方配置源码](https://github.com/redisson/redisson/blob/redisson-3.32.0/redisson-spring-boot-starter/src/main/java/org/redisson/spring/starter/RedissonAutoConfiguration.java)。

顺序约束帮助项目的客户端定义先参与处理；它不表示所有项目 Bean 的构造一定先于所有官方 Bean，也不保证 Redis 已经就绪。

还要区分两个方向：官方方法有缺失 Bean 条件；当前项目 `redissonClient()` 方法上没有看到同样的条件。因此，业务方再声明一个客户端，不能仅凭官方的退让机制就认定项目这一份也会自动消失。要检查 Bean 名冲突、多客户端候选与注入规则。

项目方法没有显式写 `destroyMethod`，不能仅凭这一点断言客户端一定泄漏：还应检查 Spring 对 Bean 销毁方法的推断、实际关闭流程，以及外部传入执行器的所有权。生命周期结论需要证据，不能只看一个注解参数是否缺失。

## 8. 公共工具一：RedissonDataHandle

源码：[RedissonDataHandle](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/handle/RedissonDataHandle.java)。

这是对 bucket 字符串读写的薄封装：

```text
get(key)                         → getBucket(key).get()，强转 String
set(key, value)                  → getBucket(key).set(value)
set(key, value, ttl, timeUnit)    → 先转 Duration，再 set(value, duration)
```

注意：接口返回 String，但真实值与 codec、其他写入方有关；它没有在这里完成所有数据类型检查。

其中 `getDuration()` 值得单独读：

```java
switch (timeUnit) {
    case MINUTES -> { return Duration.ofMinutes(timeToLive); }
    case HOURS   -> { return Duration.ofHours(timeToLive); }
    case DAYS    -> { return Duration.ofDays(timeToLive); }
    default      -> { return Duration.ofSeconds(timeToLive); }
}
```

这不是对 TimeUnit 所有单位的通用转换。传入 MILLISECONDS、MICROSECONDS 或 NANOSECONDS 都会落入 default，被当成秒；例如 1500 MILLISECONDS 得到的是 1500 秒，而不是 1.5 秒。null 则会在 switch 处失败。

第 13 课追防重复标记 TTL 时，还要回到这里核对上游传入的单位。当前实验会直接编译并调用原方法验证这一点，不访问 Redis。

## 9. 公共工具二：LocalLockCache 的初始化

源码：[LocalLockCache](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/locallock/LocalLockCache.java)。

```text
@Bean 返回 new LocalLockCache()
      ↓
Spring 注入 @Value("${durationTime:48}")
      ↓
调用 @PostConstruct localLockCacheInit()
      ↓
构造 Caffeine 缓存，expireAfterWrite(durationTime, HOURS)
      ↓
getLock(key, fair) 按 key 取得或创建 ReentrantLock
```

`new` 发生在 `@Bean` 方法内并不妨碍后续被 Spring 管理。区别在于这个返回对象进入了 Bean 生命周期，而业务代码自己 new 完直接使用的对象没有自动经历同样流程。

直接 `new LocalLockCache().getLock(...)` 时，缓存字段尚未初始化，会失败。直接手动调用初始化方法也不等同于完整绑定，因为 durationTime 仍需要先赋值。

另外不要照抄注释中的绝对化结论：同 key 的锁只在缓存条目仍有效等条件下复用，不是“永远同一把”。这里按写入时间过期，读取不会自动续期。若同 key 首次使用 fair=false，缓存未替换时再传 fair=true，不会把已有 ReentrantLock 改造成公平锁。

## 10. 公共工具三：LockInfoHandleFactory 的容器回调

源码：[LockInfoHandleFactory](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/lockinfo/factory/LockInfoHandleFactory.java)。

它实现 `ApplicationContextAware`，Spring 初始化时通过 `setApplicationContext(...)` 传入容器。随后：

```java
return applicationContext.getBean(lockInfoType, LockInfoHandle.class);
```

这是**按名称并检查类型**取得 Bean，不是根据字符串临时 new 一个类，也不是在此计算完整锁名。

两个名称来自 [LockInfoType](../damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/constant/LockInfoType.java)：

| 值 | 注册位置 | 实现 |
| --- | --- | --- |
| `service_lock` | ServiceLockAutoConfiguration | ServiceLockInfoHandle |
| `repeat_execute_limit` | RepeatExecuteLimitAutoConfiguration | RepeatExecuteLimitLockInfoHandle |

配置方法显式使用 `@Bean(LockInfoType.SERVICE_LOCK)` 等名称，所以这里不能只按方法名去猜 Bean 名。

手工 new 工厂后不设置容器就调用，会因为容器字段为空而失败。只装 common、没有注册具体策略，工厂本身可以存在，但查询具体名称时仍可能找不到 Bean。

## 11. 从底座连接四个功能模块

| 配置类 | 主要注册结果 | 与底座的连接 |
| --- | --- | --- |
| [ServiceLockAutoConfiguration](../damai-redisson-framework/damai-redisson-service-framework/damai-service-lock-framework/src/main/java/com/damai/config/ServiceLockAutoConfiguration.java) | 锁信息处理器、ManageLocker、ServiceLockFactory、ServiceLockAspect、ServiceLockTool | 注入 RedissonClient 与 LockInfoHandleFactory |
| [RepeatExecuteLimitAutoConfiguration](../damai-redisson-framework/damai-redisson-service-framework/damai-repeat-execute-limit-framework/src/main/java/com/damai/config/RepeatExecuteLimitAutoConfiguration.java) | 防重复锁信息处理器与切面 | 注入本地锁缓存、锁信息工厂、锁工厂、数据工具 |
| [BloomFilterAutoConfiguration](../damai-redisson-framework/damai-redisson-service-framework/damai-bloom-filter-framework/src/main/java/com/damai/config/BloomFilterAutoConfiguration.java) | BloomFilterProperties、BloomFilterHandler | 注入 RedissonClient；方法名 `rBloomFilterUtil` 与返回类型不同 |
| [DelayQueueAutoConfig](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/config/DelayQueueAutoConfig.java) | DelayQueueProperties、BasePart、Context、InitHandler | BasePart 持有客户端与属性，启动监听器再组织消费者 |

不要把“Bean 注册了”当成“业务行为已经发生”：切面还依赖 AOP 代理和调用方式；布隆操作还要看初始化/调用；延迟消费者还要看启动事件与 ConsumerTask；锁对象被创建也不等于已经加锁。

## 12. 四组实验：使用真实 Spring 与项目原始类

本课不启动完整应用，也不连接 Redis。实验使用：

- Spring 容器真实处理 `@Bean`、属性绑定、`@Value`、`@PostConstruct`、Aware 回调。
- 项目原始 `RedissonBaseProperties`、`LocalLockCache`、`LockInfoHandleFactory` 和 `RedissonDataHandle`。
- 两个教学策略替代真实锁名算法，避免提前引入后续章节依赖。

本机已有缓存的实验依赖为 Boot **3.5.6**、Spring **6.2.11**、Redisson **3.32.0**。它们用于独立验证下面的基础行为，不代表已按项目声明的 Boot 3.3.0 完成集成验证，也不修改项目 POM。

把下面代码保存到临时目录，文件名 `BootstrapBasicsDemo.java`。classpath 需要 Spring Context/Core/Beans/Expression/AOP/JCL、Boot/Boot Autoconfigure、Jakarta Annotation、Caffeine、AspectJ Weaver、Redisson，以及编译期 Lombok。

```java
import com.damai.config.RedissonBaseProperties;
import com.damai.handle.RedissonDataHandle;
import com.damai.locallock.LocalLockCache;
import com.damai.lockinfo.LockInfoHandle;
import com.damai.lockinfo.factory.LockInfoHandleFactory;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.aspectj.lang.JoinPoint;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import org.springframework.boot.autoconfigure.data.redis.RedisProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.MapPropertySource;

public class BootstrapBasicsDemo {
    record Holder(RedissonBaseProperties properties) {}

    static class DemoHandle implements LockInfoHandle {
        private final String label;
        DemoHandle(String label) { this.label = label; }
        public String getLockName(JoinPoint p, String n, String[] k) {
            return label;
        }
        public String simpleGetLockName(String n, String[] k) {
            return label;
        }
    }

    // 有意不写 @Configuration：本实验通过 register 显式注册配置候选。
    @EnableConfigurationProperties({RedissonBaseProperties.class, RedisProperties.class})
    static class DemoConfig {
        @Bean LocalLockCache localLockCache() { return new LocalLockCache(); }
        @Bean LockInfoHandleFactory factory() { return new LockInfoHandleFactory(); }
        @Bean("service_lock") LockInfoHandle service() { return new DemoHandle("SERVICE"); }
        @Bean("repeat_execute_limit") LockInfoHandle repeat() { return new DemoHandle("REPEAT"); }
        @Bean Holder holder(RedissonBaseProperties p) { return new Holder(p); }
    }

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext()) {
            Map<String, Object> values = Map.of(
                    "spring.data.redis.host", "redis.example.invalid",
                    "spring.redis.redisson.threads", "8",
                    "spring.redis.redisson.netty-threads", "16",
                    "spring.redis.redisson.core-pool-size", "2",
                    "durationTime", "1");
            context.getEnvironment().getPropertySources()
                    .addFirst(new MapPropertySource("demo", values));
            context.register(DemoConfig.class);
            context.refresh();

            // A：真实属性绑定、默认值与 @Bean 参数注入。
            var p = context.getBean(RedissonBaseProperties.class);
            var redis = context.getBean(RedisProperties.class);
            check(p.getThreads() == 8 && p.getNettyThreads() == 16, "绑定失败");
            check(context.getBean(Holder.class).properties() == p, "未注入同一对象");
            boolean customExecutor = p.getCorePoolSize() != null
                    && p.getMaximumPoolSize() != null;
            System.out.println("A host=" + redis.getHost() + "，threads=" + p.getThreads()
                    + "，nettyThreads=" + p.getNettyThreads());
            System.out.println("A max=" + p.getMaximumPoolSize()
                    + "，进入自定义执行器分支=" + customExecutor);
            System.out.println("A 参数注入同一属性对象="
                    + (context.getBean(Holder.class).properties() == p));

            // B：真实 @Value / @PostConstruct；不等待缓存过期。
            var cache = context.getBean(LocalLockCache.class);
            var first = cache.getLock("order:1", false);
            var second = cache.getLock("order:1", true);
            check(first == second && !second.isFair(), "缓存行为不符");
            System.out.println("B 同key复用=" + (first == second)
                    + "，第二次传true后公平=" + second.isFair());
            boolean unmanagedFailed = false;
            try {
                new LocalLockCache().getLock("order:2", false);
            } catch (NullPointerException expected) {
                unmanagedFailed = true;
            }
            check(unmanagedFailed, "未管理对象应缺少初始化");
            System.out.println("B 直接new后调用失败=" + unmanagedFailed);

            // C：真实工厂的 Aware 回调、按名查找与缺失策略。
            var factory = context.getBean(LockInfoHandleFactory.class);
            String service = factory.getLockInfoHandle("service_lock")
                    .simpleGetLockName("ignored", new String[0]);
            String repeat = factory.getLockInfoHandle("repeat_execute_limit")
                    .simpleGetLockName("ignored", new String[0]);
            check(service.equals("SERVICE") && repeat.equals("REPEAT"), "策略不符");
            boolean missing = false;
            try {
                factory.getLockInfoHandle("unknown");
            } catch (NoSuchBeanDefinitionException expected) {
                missing = true;
            }
            check(missing, "缺失策略应失败");
            System.out.println("C 命名策略=" + service + "/" + repeat
                    + "，缺失策略报错=" + missing);

            // D：直接调用项目原始方法，不调用 bucket，不使用客户端。
            var data = new RedissonDataHandle(null);
            Duration minutes = data.getDuration(2, TimeUnit.MINUTES);
            Duration milliseconds = data.getDuration(1500, TimeUnit.MILLISECONDS);
            check(minutes.equals(Duration.ofSeconds(120)), "分钟换算错误");
            check(milliseconds.equals(Duration.ofSeconds(1500)), "应复现当前default分支");
            System.out.println("D 2分钟=" + minutes.toSeconds() + "秒");
            System.out.println("D 当前1500毫秒转换结果=" + milliseconds.toMillis() + "毫秒");
        }
    }
}
```

预期标准输出：

```text
A host=redis.example.invalid，threads=8，nettyThreads=16
A max=null，进入自定义执行器分支=false
A 参数注入同一属性对象=true
B 同key复用=true，第二次传true后公平=false
B 直接new后调用失败=true
C 命名策略=SERVICE/REPEAT，缺失策略报错=true
D 2分钟=120秒
D 当前1500毫秒转换结果=1500000毫秒
```

`redis.example.invalid` 只是属性值，本实验没有创建 RedissonClient，因此没有尝试解析或连接它。D 的 null 客户端只用于调用不依赖客户端的单位转换方法，不能据此在生产中构造这样的工具对象。

### 本机复现步骤（PowerShell）

在仓库根目录执行。将 `$demoDir` 设为保存上述 Java 文件的临时目录。下面只编译必要原始类，不编译整个业务工程，也不启动 Redis。

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
  'org/springframework/boot/spring-boot/3.5.6/spring-boot-3.5.6.jar'
  'org/springframework/boot/spring-boot-autoconfigure/3.5.6/spring-boot-autoconfigure-3.5.6.jar'
  'jakarta/annotation/jakarta.annotation-api/2.1.1/jakarta.annotation-api-2.1.1.jar'
  'com/github/ben-manes/caffeine/caffeine/3.2.2/caffeine-3.2.2.jar'
  'org/aspectj/aspectjweaver/1.9.24/aspectjweaver-1.9.24.jar'
  'org/redisson/redisson/3.32.0/redisson-3.32.0.jar'
  'org/projectlombok/lombok/1.18.44/lombok-1.18.44.jar'
)
$jars = @($jarPaths | ForEach-Object { Join-Path $m2 $_ })
foreach ($jar in $jars) {
  if (-not (Test-Path -LiteralPath $jar)) { throw "缺少实验依赖：$jar" }
}
$cp = $jars -join [IO.Path]::PathSeparator
$commonSource = Join-Path $repo 'damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai'
$sources = @(
  (Join-Path $commonSource 'config/RedissonBaseProperties.java')
  (Join-Path $commonSource 'locallock/LocalLockCache.java')
  (Join-Path $commonSource 'lockinfo/LockInfoHandle.java')
  (Join-Path $commonSource 'lockinfo/factory/LockInfoHandleFactory.java')
  (Join-Path $commonSource 'handle/RedissonDataHandle.java')
  (Join-Path $demoDir 'BootstrapBasicsDemo.java')
)
$classes = Join-Path $demoDir 'classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
javac --release 17 -encoding UTF-8 -cp $cp -processorpath $jars[-1] -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw '编译失败' }
$runCp = $classes + [IO.Path]::PathSeparator + $cp
java '-Dstdout.encoding=UTF-8' -cp $runCp BootstrapBasicsDemo
if ($LASTEXITCODE -ne 0) { throw '实验失败' }
```

若本地没有这些版本，先使用匹配的独立实验依赖环境；不要为了运行讲义直接升级业务 POM。控制台可能包含 JDK、注解处理器或日志实现提示，核对时区分这些诊断与程序标准输出。

验证记录（2026-11-03）：从本文提取完整 Java 示例和 PowerShell 编译运行脚本，使用 OpenJDK 25.0.2、`javac --release 17` 及上列实验依赖，编译五个项目原始类/接口并运行成功。四组标准输出与预期逐行一致；编译期出现 Lombok 使用 JDK Unsafe 的弃用提示。未修改项目源码、POM 或全局依赖配置。课程本地链接与代码围栏检查通过，未进行 Redis 和全应用集成测试。

## 13. 启动问题的定位顺序

| 观察结果 | 优先检查 |
| --- | --- |
| 找不到某功能类型的 Bean | 应用依赖是否引入模块，imports 是否进入产物，配置候选是否被排除 |
| 缺少 RedisProperties 或其他参数 Bean | 相关标准自动配置是否存在、启用；手工容器是否显式提供 |
| 属性一直是默认值 | 前缀、激活配置、外部配置来源、绑定访问器；不要只看 YAML 文件存在 |
| 多个 RedissonClient 候选或名称冲突 | 项目与业务方定义、条件退让、名称与主候选规则 |
| 已进入 Redisson.create 后失败 | 最终生成的模式、地址、认证、网络及初始化异常根因 |
| 工具调用时字段为空 | 对象是否被 Spring 管理，注入和初始化回调是否执行 |
| 改了配置但行为不变 | 配置是否绑定；工厂是否真正读取并传入该值 |

必要时用 Boot `--debug` 条件报告核对自动配置，并结合异常链与断点。报告说明配置与条件信息，不直接证明所有业务路径已经正常运行。

不要在排查日志中直接输出包含密码的完整属性或配置对象；本课实验只输出非敏感教学字段。

## 14. 源码阅读任务

按下面顺序完成一张自己的装配图：

1. 从应用 POM 找到一个功能模块，再追到 common。
2. 打开该功能模块和 common 的两个 imports 文件。
3. 为 common 四个 Bean 方法标出返回类型与依赖。
4. 在 `redissonClient()` 每个设置旁标注“标准属性 / 项目属性 / 硬编码”。
5. 跟踪 `LocalLockCache` 的字段注入与初始化时刻。
6. 跟踪一个 `service_lock` 命名策略如何被注册与查询。

此时应该能画出：

```text
应用依赖 → classpath自动配置候选 → 配置解析与属性绑定
                                     │
               RedisProperties + RedissonBaseProperties
                                     ↓
                          RedissonClient Bean
                            ↙       ↓       ↘
                      锁模块      布隆模块   延迟队列模块
                        ↓
                    防重复模块

common 同时提供：数据工具、本地锁缓存、锁信息处理器工厂
```

图表达依赖关系，不是严格的所有构造方法调用时间表。

## 15. 自测题

1. `<modules>` 是否表示所有子模块自动互相依赖？
2. 延迟队列与 service-framework 是什么目录关系？
3. 当前自动配置候选文件的完整资源路径是什么？
4. 类名以 AutoConfiguration 结尾就一定会被发现吗？
5. 当前配置类没统一写 `@AutoConfiguration`，为什么不能直接判定无效？
6. `@AutoConfigureBefore` 是否保证所有 Bean 都先构造完？
7. 标准连接属性与项目线程属性分别使用什么前缀？
8. 只写 `@ConfigurationProperties` 就必然已经有属性 Bean 吗？
9. 当前客户端工厂支持依据 cluster 配置自动切换集群吗？
10. 标准 connect-timeout 设为 5 秒后，此工厂传入的连接超时是多少？
11. Boot 3.3.0 开启 ssl.enabled，当前旧反射逻辑会自动切换协议吗？
12. 只设置 corePoolSize=2，是否创建自定义执行器？
13. core 和 max 都非 null，是否说明参数必然合法？
14. 官方 starter 会退让，是否意味着项目工厂也一定向用户 Bean 退让？
15. `@Bean` 方法内 new 的对象是否仍能收到 `@Value` 与初始化回调？
16. 直接 new LocalLockCache 后立刻 getLock，当前会怎样？
17. 同 key 先取非公平锁，再传 fair=true，是否立即换成公平锁？
18. LockInfoHandleFactory 按什么找处理器，容器字段谁赋值？
19. getDuration(1500, MILLISECONDS) 当前返回多少毫秒？
20. 本课实验能否证明项目声明版本下全应用已连接 Redis 并正常启用 AOP？

## 16. 参考答案

### 1. 模块与依赖

不能。modules 组织构建；依赖关系要看 dependencies 及其传递解析结果。

### 2. 目录关系

两者都在 damai-redisson-framework 下；延迟队列不是 service-framework 内的第五个子模块，但依赖其中的 common。

### 3. 候选资源

`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`，文件中按行列全限定类名。

### 4. 命名与发现

不能。名称只是约定，要有被导入、注册或扫描等实际路径；本项目明确提供 imports。

### 5. 当前配置类

要结合导入路径及 Spring 配置元数据解析。当前类列在自动配置候选文件中，并含 Bean 或属性启用元数据，不能只凭一个注解缺失下结论。

### 6. 排序与实例化

不保证。自动配置排序影响定义处理，实例化还由依赖与生命周期等因素决定，也不代表远程服务已经就绪。

### 7. 两个前缀

标准连接为 spring.data.redis；项目线程参数为 spring.redis.redisson。

### 8. 属性注册

不必然。还需要启用属性类、扫描、显式注册等路径。当前自定义属性由 EnableConfigurationProperties 启用。

### 9. 客户端模式

当前固定 useSingleServer，没有根据 cluster/sentinel 切换的分支。

### 10. 连接超时

仍传入硬编码 1000 毫秒；成功绑定一个属性不等于当前工厂已经使用它。

### 11. SSL

不会由这段旧逻辑自动切换。Boot 3.3.0 使用 getSsl().isEnabled()；当前只找顶层 isSsl()，找不到便保持 redis://。

### 12. 执行器开关

不创建；maximumPoolSize 仍为 null，两个条件必须同时满足。

### 13. 参数合法性

不能。例如 core 大于 max 或队列容量非正仍会失败，需继续检查构造器约束与配置验证。

### 14. 退让方向

不能。官方创建方法有缺失客户端条件，当前项目方法没有展示同样条件，要另外检查重复定义与注入结果。

### 15. Bean 返回对象

可以。返回值进入 Spring Bean 生命周期，后处理器可继续完成注入与初始化。

### 16. 直接 new

缓存字段未初始化，getLock 会出现 NullPointerException；也没有自动注入 durationTime。

### 17. 公平参数

缓存条目有效时继续复用已有非公平锁；fair 参数用于缺失条目时创建，不能改变既有 ReentrantLock 的公平属性。

### 18. 工厂查询

按名称和 LockInfoHandle 类型查询。Spring 通过 ApplicationContextAware 回调设置容器字段。

### 19. 单位转换

当前返回 1500000 毫秒，即 1500 秒。MILLISECONDS 落入 default，错误地按秒解释，实验直接复现原始方法。

### 20. 验证边界

不能。实验使用明确列出的本地缓存版本与少量原始类，显式注册配置，只验证绑定、生命周期、命名查找和单位转换；没有验证 imports 全链路、真实客户端、Redis 连接、AOP 或业务服务集成。

## 17. 本课通关与下一课

能够独立解释：客户端从哪里来、每组配置谁读取、LocalLockCache 为什么不能随便直接 new、策略处理器为何要使用指定 Bean 名。

下一课：[第 10 课：锁名生成与工厂（含答案）](damai-redisson-framework-第10课-锁名生成与工厂（含答案）.md)，进入 LockInfoHandle、两类处理器与 SpEL 拼接，追清业务参数最终怎样形成共享 Redis 锁名。
