---
title: "redisson应用-第04课-AOP代理与事务切面（含答案）"
description: "redisson应用系列第04课，主题：AOP代理与事务切面（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 04 课：Spring AOP、代理与事务切面（含答案）

## 1. 本课目标

前面已经知道怎样获取、持有和释放锁。这一课解释：为什么只给方法写上 @ServiceLock，就有可能在执行前后加锁、解锁？又为什么有时写了注解仍没有进入切面？

重点掌握代理、目标对象、切点、环绕通知、proceed、自调用与多个切面的顺序，最后分析锁与数据库事务的边界。

不要求先手写动态代理或通读 Spring AOP 底层。先能根据一条方法调用画出执行链，就可以继续学习项目源码。

课程总入口：[学习导航](damai-redisson-framework-课程学习导航.md)。

## 2. 注解本身不会执行加锁代码

Java 注解首先是一份元数据。它可以记录锁名、keys、等待时间等，但不会自己调用 Redis。

需要一条实际执行机制：

```text
注解声明规则
    ↓
Spring 注册切面并建立匹配规则
    ↓
调用经过代理
    ↓
切面读取注解、生成锁名、获取锁
    ↓
执行业务并按路径释放
```

因此要区分三个事实：源码里有注解，容器中有切面，当前调用确实经过该切面。这三件事不能互相代替。

## 3. 代理对象与目标对象

你调用的可能是一个代理，而不是直接调用业务对象：

```text
Controller / 其他调用方
    ↓
代理对象：拦截与组合处理
    ↓
目标对象：真正的业务方法
```

代理对外提供相应业务接口或类型，在委托目标方法前后执行额外逻辑。

| 名称 | 本课含义 | 项目例子 |
| --- | --- | --- |
| Target，目标 | 执行业务的原对象 | OrderService |
| Proxy，代理 | 包含拦截链的调用入口 | 容器返回给调用方的代理引用 |
| Join point，连接点 | Spring AOP 中可被拦截的方法执行 | cancel 方法的相应调用 |
| Pointcut，切点 | 匹配哪些方法的规则 | @annotation(servicelock) |
| Advice，通知 | 匹配后执行什么逻辑 | 加锁、proceed、释放 |
| Aspect，切面 | 组织切点与通知的类 | ServiceLockAspect |

不要把“锁名”与“切点”混淆：切点决定哪些方法被处理，锁名决定这些调用竞争哪份协调状态。

## 4. JDK 代理和 CGLIB 先知道什么？

| 机制 | 基本方式 | 阅读时注意 |
| --- | --- | --- |
| JDK 动态代理 | 实现相应接口并转发调用 | 调用方看到的是代理接口能力 |
| CGLIB 类代理 | 生成目标类的子类 | 类和方法能否被继承、覆盖影响拦截 |

不能只根据目标有没有接口，就忽略 Spring Boot 或显式配置的代理策略。后面实验会明确设置 proxyTargetClass=true，观察类代理，不把它当作所有项目的默认选择。

针对类代理，final 类不能被继承，final 方法不能通过覆盖拦截，private 方法也不能靠这种方式被覆盖。不要写了注解后才发现方法根本不在当前代理机制的可拦截范围。

接口代理与类代理对可见性、接口方法等还有具体规则。本阶段以 public 业务方法建立主线，避免把类代理限制不加区分地套到所有机制。

参考：[Spring 官方代理机制](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)。官网版本会更新，本文不使用当前官网新增 API 代替项目配置。

## 5. @Around 与 proceed：真正的包装关系

一个简化的环绕通知：

```java
public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
    before();
    try {
        return joinPoint.proceed();
    } finally {
        after();
    }
}
```

这是结构示意，before / after 为教学方法。proceed 的意思是继续当前拦截链，后面可能还有其他通知，最后才到目标方法。

它不是“忽略其他切面直接调用原方法”。环绕通知还可以不 proceed，而是返回备用结果或抛异常。

| 写法或行为 | 后果 |
| --- | --- |
| 正常调用一次 proceed | 后续链与目标按条件执行一次 |
| 未调用 proceed 就抛异常 | 原业务可能根本没执行 |
| 未调用 proceed 而返回备用值 | 调用方得到替代结果 |
| 调用多次 proceed | 可能重复执行后续业务，不应无意这样写 |

返回值与异常都属于这个包装结构的一部分，不只是“前面打印一行日志”。

参考：[Spring 官方通知说明](https://docs.spring.io/spring-framework/reference/core/aop/ataspectj/advice.html)。

## 6. 回到项目 ServiceLockAspect

文件位于 `damai-redisson-framework/damai-redisson-service-framework/damai-service-lock-framework/src/main/java/com/damai/servicelock/aspect/ServiceLockAspect.java`。

```java
@Aspect
@Order(-10)
public class ServiceLockAspect {
    @Around("@annotation(servicelock)")
    public Object around(ProceedingJoinPoint joinPoint,
                         ServiceLock servicelock) throws Throwable {
        // 读取注解、生成锁名、选择锁实现
        // 成功获取后 proceed，最后释放
    }
}
```

这是省略字段和实现的阅读片段。servicelock 参数来自切点绑定，让通知获得本次方法匹配的注解信息。

方法里使用 joinPoint 获取目标、方法签名与实参。后续课程会把 keys 中的 SpEL 与这些实参连接起来。

### 谁把这个切面注册进容器？

ServiceLockAutoConfiguration 的 @Bean 方法创建 ServiceLockAspect；配置类通过模块 imports 参与自动配置。

切面类不需要因为没有 @Component 就一定无法注册，@Bean 是另一条路径。但 @Aspect 本身也不是“无论容器是否发现这个类都能生效”的注册魔法。

还需要 AOP 基础设施和匹配的代理调用。具体依赖与自动配置在工程源码课进一步验证。

## 7. 获取失败时，proceed 不一定发生

项目中成功取得锁的分支：

```java
if (result) {
    try {
        return joinPoint.proceed();
    } finally {
        lock.unlock(lockName);
    }
}
```

失败分支则检查自定义处理方法或默认策略。默认 FAIL 会抛异常；有自定义策略时，会反射调用相应方法并返回结果。

所以不能只看源码末尾还有一个 proceed，就说获取失败也一定执行业务。需要沿当前分支看前面是否抛出或 return。

反射调用目标上的自定义处理方法，也不能自动认定它再次经由相同 Spring 代理。它的调用对象和路径要单独确认。

## 8. 自调用：this.method() 为什么不同？

典型结构：

```java
public void outer() {
    inner();
}

@ServiceLock(name = "demo", keys = {"'one'"})
public void inner() {
    // 业务
}
```

这是说明代理机制的示意片段，不要求此刻掌握 keys 的表达式。

当 outer 已进入目标对象，在内部直接调用 this.inner，调用不重新从外部代理入口进入。因此在常见 Spring 代理式 AOP 下，inner 的这次自调用不会自动重新触发相应通知。

```text
外部 → 代理.outer → 目标.outer → 目标.inner
                                ↑ 没有再次经过代理.inner
```

普通 new 出来的目标对象直接调用带注解方法，同样不会仅凭注解自动获得容器代理。

这讨论的是 Spring 代理式 AOP，不把它扩展成所有字节码织入技术都绝不支持内部调用。课程不要求使用其他织入模式来掩盖代理边界。

### 项目中可以观察的真实位置

OrderService.initiateCancel 自身带防重复、锁和事务注解，方法内部又调用 cancel(orderCancelDto)。

不能因此断言 cancel 上的每种通知会重新执行一次；也不能反过来断言完全无保护，因为 initiateCancel 自己若通过代理进入，已有的外层通知仍可能有效。

正确问题是：当前外部入口是谁，哪一层通知已建立，内部调用有没有重新穿过代理？

## 9. 注解能标在类上，不等于切点必然匹配类上注解

ServiceLock 的 Target 包括 TYPE 和 METHOD，但当前切点使用 @annotation(servicelock)，关注方法上的匹配注解。

“Java 允许把注解写在类上”与“当前切点按类上的注解覆盖全部方法”是不同事情。后者通常还涉及 @within / @target 等不同规则及绑定方式，不能混为一谈。

实验会单独展示类上有注解、方法没有注解时，当前形式的匹配结果。接口、实现与继承的注解查找还有细节，后续锁名和反射课继续分析。

## 10. 多个切面怎样嵌套？

项目声明：

- RepeatExecuteLimitAspect：@Order(-11)。
- ServiceLockAspect：@Order(-10)。

在二者实际匹配、由同一相应代理链排序等前提下，数值更小的优先进入，向外返回时呈嵌套顺序：

```text
防重复通知进入（-11）
    锁通知进入（-10）
        目标方法或其他后续通知
    锁通知退出
防重复通知退出
```

Order 不是“把整个应用所有方法和过滤器统一放进一条全局队列”。只有处在相应排序集合和调用路径中才有这个含义。同值顺序也不能仅凭文件名决定。

同一方法里注解写在第几行，不决定拦截器优先级。

## 11. 事务也是代理处理，方法返回与提交需分开

在常见命令式 Spring 事务代理中，事务通知根据传播与回滚规则，围绕目标调用处理开启、提交或回滚。

```text
事务拦截器进入 → 取得或加入事务 → 调目标
    → 根据结果完成事务处理 → 返回外层
```

项目常见 `@Transactional(rollbackFor = Exception.class)`，表示相应回滚规则，不代表所有错误都必然回滚任何外部系统状态。

业务把异常吞掉、返回失败码，代理看到的可能仍是正常返回；但事务也可能已被标记 rollback-only，不能把正常返回机械等同“最终必定提交”。

返回 Future、Mono 等异步类型还涉及不同的执行或事务支持，不能把本课同步事务时间线直接套到所有异步方式。

参考：[Spring 官方声明式事务说明](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)。

## 12. 锁与事务：两种嵌套有何区别？

### 结构 A：锁在外，事务在内

```text
获取锁
    开始本次事务
        业务方法
    提交或回滚本次事务
释放锁
```

### 结构 B：事务在外，锁在内

```text
开始事务
    获取锁
        业务方法
    释放锁
提交或回滚事务
```

B 中可能出现锁已经释放，而本次事务尚未提交的间隙。是否满足业务要求，需要结合数据访问与事务语义分析，不能仅凭有两个注解就认定顺序正确。

也不要对 A 过度承诺：若内层只是加入一个更外层已存在的事务，局部代理返回时未必完成最终提交。事务传播、新建还是参与已有事务都会影响时间线。

因此要核查实际事务 advisor 的 order、代理层次、传播和外部调用者，而不是从 @Order(-10) 直接推断所有业务都在释放前提交。

## 13. 三层合起来：成功标记何时写？

在本次调用确实形成“防重复 → 锁 → 新事务 → 业务”的同步结构时，可以推演：

```text
防重复查标记与获取自己的相关锁
    获取业务 ServiceLock
        本次事务开始
            业务执行
        事务完成
    释放业务 ServiceLock
防重复通知的 proceed 正常返回
按 durationTime 等条件写成功标记
释放防重复通知持有的相关锁
```

这只是明确前提下的结构，不是预先证明了本项目每次调用都如此。各锁的 key 也不一定相同。

标记写入仍是另一份 Redis 状态，可能失败。即使事务提交成功，也不能认定两者在同一个事务里一起提交；durationTime=0 时当前防重复切面还不会写该标记。

## 14. 独立 Spring 实验：六条调用路径

下面运行真实 Spring AOP 与事务拦截器，不启动 Spring Boot，也不连接 Redis 或数据库。

- 两个 Aspect 用日志模拟防重复和锁通知，不执行真实获取锁。
- LoggingTxManager 是只打印日志的事务管理器；实际由 Spring 事务机制调用 begin / commit / rollback，但没有数据库资源或真实数据回滚。
- 显式设置类代理和事务 order=0，只验证这个示例配置，不代替项目运行时顺序。
- 两个教学注解不是项目注解，实验不包含真实锁名、SpEL 或 Redis。

需要匹配的 spring-context、spring-aop、spring-beans、spring-core、spring-expression、spring-jcl、spring-tx，以及 AspectJ Weaver 和相关基础依赖。保存为 `RedissonAopBasicsDemo.java`，作为普通 main 运行。

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.core.annotation.Order;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

public class RedissonAopBasicsDemo {
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface RepeatGate {}

    @Retention(RetentionPolicy.RUNTIME)
    @Target({ElementType.METHOD, ElementType.TYPE})
    public @interface LockGate {
        boolean reject() default false;
    }

    @Aspect
    @Order(-11)
    public static class RepeatAspect {
        @Around(value = "@annotation(repeatGate)", argNames = "joinPoint,repeatGate")
        public Object around(ProceedingJoinPoint joinPoint, RepeatGate repeatGate) throws Throwable {
            System.out.println("防重复进入");
            try {
                Object result = joinPoint.proceed();
                System.out.println("防重复观察到正常返回");
                return result;
            } finally {
                System.out.println("防重复退出");
            }
        }
    }

    @Aspect
    @Order(-10)
    public static class LockAspect {
        @Around(value = "@annotation(lockGate)", argNames = "joinPoint,lockGate")
        public Object around(ProceedingJoinPoint joinPoint, LockGate lockGate) throws Throwable {
            if (lockGate.reject()) {
                System.out.println("锁通知拒绝");
                throw new IllegalStateException("未取得锁");
            }
            System.out.println("模拟取得锁");
            try {
                return joinPoint.proceed();
            } finally {
                System.out.println("模拟释放锁");
            }
        }
    }

    public static class LoggingTxManager extends AbstractPlatformTransactionManager {
        protected Object doGetTransaction() {
            return new Object();
        }
        protected void doBegin(Object transaction, TransactionDefinition definition) {
            System.out.println("事务开始");
        }
        protected void doCommit(DefaultTransactionStatus status) {
            System.out.println("事务提交回调");
        }
        protected void doRollback(DefaultTransactionStatus status) {
            System.out.println("事务回滚回调");
        }
    }

    public static class DemoService {
        @RepeatGate
        @LockGate
        @Transactional
        public String run(boolean fail) {
            System.out.println("业务方法 fail=" + fail);
            if (fail) throw new IllegalStateException("业务失败");
            return "ok";
        }
        public String selfCall() {
            return run(false);
        }
        @LockGate(reject = true)
        @Transactional
        public void blocked() {
            System.out.println("不应执行的业务");
        }
    }

    @LockGate
    public static class ClassOnlyService {
        public void run() {
            System.out.println("仅类上有注解的业务");
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    @EnableTransactionManagement(order = 0)
    public static class AppConfig {
        @Bean public DemoService demoService() { return new DemoService(); }
        @Bean public ClassOnlyService classOnlyService() { return new ClassOnlyService(); }
        @Bean public RepeatAspect repeatAspect() { return new RepeatAspect(); }
        @Bean public LockAspect lockAspect() { return new LockAspect(); }
        @Bean public PlatformTransactionManager transactionManager() { return new LoggingTxManager(); }
    }

    public static void main(String[] args) {
        System.out.println("-- A: 普通new对象 --");
        new DemoService().run(false);
        try (AnnotationConfigApplicationContext context =
                     new AnnotationConfigApplicationContext(AppConfig.class)) {
            DemoService service = context.getBean(DemoService.class);
            System.out.println("-- B: 代理正常调用 --");
            System.out.println("是代理=" + AopUtils.isAopProxy(service));
            service.run(false);

            System.out.println("-- C: 代理业务异常 --");
            try {
                service.run(true);
            } catch (IllegalStateException error) {
                System.out.println("调用方捕获=" + error.getMessage());
            }

            System.out.println("-- D: 目标内部自调用 --");
            service.selfCall();

            System.out.println("-- E: 通知拒绝后不继续 --");
            try {
                service.blocked();
            } catch (IllegalStateException error) {
                System.out.println("调用方捕获=" + error.getMessage());
            }

            System.out.println("-- F: 仅类上注解 --");
            context.getBean(ClassOnlyService.class).run();
        }
    }
}
```

预期输出：

```text
-- A: 普通new对象 --
业务方法 fail=false
-- B: 代理正常调用 --
是代理=true
防重复进入
模拟取得锁
事务开始
业务方法 fail=false
事务提交回调
模拟释放锁
防重复观察到正常返回
防重复退出
-- C: 代理业务异常 --
防重复进入
模拟取得锁
事务开始
业务方法 fail=true
事务回滚回调
模拟释放锁
防重复退出
调用方捕获=业务失败
-- D: 目标内部自调用 --
业务方法 fail=false
-- E: 通知拒绝后不继续 --
锁通知拒绝
调用方捕获=未取得锁
-- F: 仅类上注解 --
仅类上有注解的业务
```

观察 D：外部虽然调用了容器返回的对象，但 selfCall 本身未匹配这些注解，进入目标后再调 run，不会自动重新经过 run 对应的代理链。

观察 C：RuntimeException 按本实验事务规则进入回滚回调；模拟锁的 finally 仍执行，但“防重复观察到正常返回”不出现。

观察 F：允许 TYPE 并不让 @annotation 自动变成类级切点。

验证记录：本地 JDK 25 使用 `--source 17`，搭配 Spring 6.2.11、AspectJ Weaver 1.9.24 运行，六组实际输出均与讲义一致。未连接 Redis、数据库，也未启动完整业务工程。

## 15. 源码跟读与断点清单

| 位置 | 观察什么 |
| --- | --- |
| 调用 OrderService 之前 | 注入对象是否代理、外部入口方法是谁 |
| RepeatExecuteLimitAspect.around | 注解、锁名、是否会继续 proceed |
| ServiceLockAspect.around | result、自定义策略、proceed 前后 |
| 目标业务方法入口 | 事务是否已按相应配置建立 |
| initiateCancel 内部调用 cancel | 是否再次进入两个 around |
| 最内层 proceed 返回之后 | 是目标返回还是内层通知已返回，事务有没有最终完成 |
| 两个 finally | 释放的是哪把锁，异常是否继续向外 |

完整环境未就绪时先做独立 Spring 实验，不必为了理解代理启动 Redis 与数据库。实际代理、事务传播和业务资源需在集成阶段另外验证。

## 16. 练习

1. @ServiceLock 注解本身会直接执行 Redis 命令吗？
2. @Aspect 是否等于这个类无条件成为容器 Bean？
3. ProceedingJoinPoint.proceed 是跳过其他通知直接调用业务吗？
4. 环绕通知不调用 proceed，还能返回结果吗？
5. 普通 new 对象调用带注解方法，是否自动得到 Spring AOP？
6. 外部调 outer，outer 内部调 this.inner，inner 通知必定再执行一次吗？
7. initiateCancel 内部调 cancel 没再次进切面，是否等于整个请求一定完全没锁？
8. 注解允许标 TYPE，@annotation 是否就匹配所有仅类上标注的方法？
9. 两个切面的 Order=-11 与 -10，正常嵌套谁先进入？
10. 在方法上调整注解书写顺序，能决定 advisor 顺序吗？
11. 当前实验为什么事务提交回调出现在模拟释放锁之前？
12. 只看锁切面 Order=-10，能证明项目全部事务都先提交再释放吗？
13. 内层事务加入外层事务时，内层方法返回是否必定最终提交？
14. 业务返回失败码而未抛异常，防重复通知是否自动识别业务失败？
15. 获取锁失败，源码末尾有 proceed，是否代表一定执行原业务？
16. 实验的 rollback 回调是否证明真实数据库行已回滚？
17. 同步切面 try 中返回 Future，finally 会自动等后台任务吗？
18. 本课 CGLIB 实验是否证明实际工程一定采用相同代理策略和顺序？

## 17. 参考答案

### 1. 注解的职责

不会直接执行。注解保存配置，由装配好的切面、代理和实际调用路径读取并执行逻辑。

### 2. Aspect 与 Bean 注册

不等同。类需要被容器注册，当前项目通过配置的 Bean 方法提供切面；还要有 AOP 基础设施。

### 3. proceed 的位置

是继续当前拦截链，可能先进入其他通知，最终才到目标方法。不能把它当成忽略全部代理的原方法调用。

### 4. 不继续也能返回

可以，环绕通知可以拒绝、返回备用值或抛异常。因此业务有没有执行应看具体分支。

### 5. 普通对象

不会仅因注解获得 Spring 代理能力。普通 new 和直接目标调用与经容器代理调用不同。

### 6. 自调用

在常见 Spring 代理式 AOP 下不会自动重新经过代理。要分析调用对象，不能只看 inner 的注解。

### 7. 外层已有保护

不等于。外部进入 initiateCancel 的相应通知可能已经建立保护，只是不能认为内部 cancel 会再次触发全部通知。

### 8. 类级注解与方法切点

不会自动覆盖。TYPE 说明 Java 可以这样标，@annotation 的匹配规则仍需单独满足，类级规则是另一回事。

### 9. 两个 Order

在同一相应排序链且均匹配时，-11 先进入、最后退出，-10 位于其内层。不能用于比较无关处理机制。

### 10. 注解行顺序

不能替代 advisor 排序规则。应查 Order、配置与实际代理链，而不是源代码排列。

### 11. 实验事务在内

实验显式把事务 order 设为 0，锁通知为 -10，所以锁包住本次事务通知；内层返回前调用提交回调，再到外层 finally。

### 12. 能否推断整个项目

不能。要检查事务 advisor 顺序、代理层次、传播以及调用方是否已有事务。单个 Order 值不足以证明全部路径。

### 13. 参与事务与最终提交

不必然。加入已有事务时，最终提交可能由更外层边界决定，内层方法返回不等于数据库已最终提交。

### 14. 正常返回与业务成功

当前防重复切面没有按返回业务码检查，正常返回可能继续写标记。方法返回、事务结果与业务成功要分别确认。

### 15. 未取得锁是否继续

不一定。默认 FAIL 会抛异常，自定义处理可能先返回。末尾代码存在不代表当前分支会走到那里。

### 16. 实验事务资源

没有真实数据库。它运行真实 Spring 事务拦截与日志管理器回调，只验证回调与代理顺序，不验证数据库持久化、隔离和回滚。

### 17. Future 与 finally

不会自动等。同步通知的 finally 对应当前 proceed 返回边界，异步工作可能尚未完成，保护范围要另行设计。

### 18. 实验与工程

没有证明。实验明确选择类代理和事务顺序；实际工程还需检查依赖、自动配置、最终 Bean、传播与真实调用链。

## 18. 本课通关与下一课

请选择一个 @ServiceLock 方法，画出调用方、代理、锁通知、事务通知和目标对象；再画一条目标内部自调用，指出它与外部调用的区别。

下一课学习注解、反射、参数名与 SpEL，把 keys={"#dto.orderNumber"} 如何变成真正锁名讲清，并连接 AbstractLockInfoHandle 的实现。

继续阅读：[第 05 课：注解、反射、参数名与 SpEL（含答案）](damai-redisson-framework-第05课-注解反射与SpEL（含答案）.md)。
