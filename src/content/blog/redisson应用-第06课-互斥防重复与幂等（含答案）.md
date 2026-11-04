---
title: "redisson应用-第06课-互斥防重复与幂等（含答案）"
description: "redisson应用系列第06课，主题：互斥防重复与幂等（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 06 课：互斥、防重复与业务幂等（含答案）

## 1. 本课目标

你已经知道锁与代理怎样工作。现在区分三个容易混用的目标：

- 同一时刻，不让不同竞争者一起处理某个资源。
- 同一个请求再次到来时，能够识别它是否已经处理过。
- 请求重试或消息重投时，业务效果仍符合约定，不重复扣款、退款或创建记录。

本课先建立概念，再映射 RepeatExecuteLimitAspect。完整切面逐行阅读放在第 13 课，本课不提前把全部框架细节塞进来。

课程入口：[学习导航](damai-redisson-framework-课程学习导航.md)。

## 2. 为什么会收到重复请求？

不只有用户连续点击按钮：

1. 服务已经处理，但客户端没有收到响应，于是重试。
2. 上游超时重试，原请求实际上仍在运行。
3. 消息处理后未完成相应确认，又被重新交付。
4. 定时补偿与正常流程同时处理同一业务。

所以不能只靠前端禁用按钮解决。也不能把重复请求一律当成错误：有时它是在不确定结果后恢复业务的必要方式。

第一步应该问：重复的是同一个业务操作，还是两个不同但参数看起来相似的操作？

## 3. 并发重复与顺序重复

### 并发重复

```text
A 开始处理订单 1001 ─────────────── 结束
        B 又来处理订单 1001 ───────
```

两次执行时间重叠。合适的互斥能让其中一个等待或拒绝，但要确保所有调用遵守同一后端、锁名与保护范围。

### 顺序重复

```text
A 处理订单 1001 → 完成并释放锁
                                 B 重试同一操作 → 再次取得锁
```

锁已释放后，B 可以正常拿到锁。因此“每次都成功加锁”并不能证明业务只发生一次。

## 4. 三个概念分别回答什么？

| 概念 | 要回答的问题 | 常见手段 |
| --- | --- | --- |
| 互斥 | 现在是否允许多个竞争者同时进入？ | 本地锁、分布式锁、数据库锁等 |
| 重复识别或抑制 | 这次操作是否已经处理过，或正在处理？ | 稳定操作标识、状态记录、一定时长内的标记 |
| 业务幂等 | 同一约定操作重复提交后，业务效果是否仍符合一次处理的含义？ | 状态机、唯一约束、条件更新、结果记录及必要事务 |

它们可以组合，但不能互相代替。

幂等也不要求每次返回完全相同的 HTTP 状态、日志条数或处理时间。核心是约定的业务效果，而不是要求代码绝不再执行任何一行。

HTTP 语义也按重复相同请求的预期效果理解幂等；本课讨论的是业务操作层面的实现，不凭 HTTP 方法名就认定数据库逻辑正确。参考：[RFC 9110 的幂等方法语义](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods)。

## 5. 一个业务例子：取消订单与退款

只把状态设为 CANCELLED，多次重复赋同一状态可能看起来没有差别。

但如果每次都附带：

```text
修改状态 + 退还库存 + 退款 + 发送通知
```

重复效果就可能出现在其他步骤。状态一样不表示库存没加两次，或退款没发两次。

因此设计时应列出全部需要约束的业务效果，确认每一步对应的身份、状态、条件与失败恢复机制，而不是只看一个字段最终相同。

## 6. 幂等键：怎样识别“同一次操作”？

常见维度包括：业务操作类型、订单号、请求号、支付流水号、消息事件 ID。

| key 选择 | 可能的问题 |
| --- | --- |
| 每次重试生成新 UUID | 系统无法识别它们属于同一次操作 |
| 只使用 userId | 用户两个不同订单可能被误认为重复 |
| 只使用订单号，混合取消和支付 | 不同操作可能被错误混在一起 |
| 事件有稳定 ID，但每次封装消息都重新生成 | 无法按稳定事件身份去重 |

一个可理解的教学形状：

```text
cancel:order:1001
payment:trade:20260001
consume:api-data:event-001
```

这是示例，不替代本项目真实锁名。项目实际使用注解 name、keys 求值与前缀组合，第 05 课已经解释。

### 相同 key、不同参数怎么办？

如果相同请求标识却带了不同金额或业务内容，不能不加检查就当作合法重试并返回旧结果。常见设计会记录相关业务内容或摘要，按约定识别冲突。

当前 RepeatExecuteLimitAspect 没有通用请求内容指纹或结果回放实现；不能因注解名叫防重复就把这些能力都算进去。

## 7. 成功标记：简单，但有范围

一种基本想法：

```text
按 key 查标记
    ├── 已成功：拒绝重复，或按协议返回已处理结果
    └── 未成功：尝试处理 → 正常完成 → 写标记
```

标记通常带 TTL，意味着这份识别状态只在相应范围内有效。过期、丢失或未成功写入后，不能再依赖它阻止顺序重复。

拒绝重复与回放上次结果是不同产品语义。本项目当前保存 success 文本，命中时抛异常；不是缓存并返回上一次完整业务响应。

### 只做第一次查询为什么不够？

```text
A 查不到标记
B 也查不到标记
A 处理并写成功标记
B 仍根据之前的旧判断继续处理
```

要把关键检查与执行范围放在合适协调机制中，并在取得保护后重新确认。否则查询标记本身不会让整个业务原子化。

## 8. 项目的完整组合，先看职责

RepeatExecuteLimitAspect 的主线是：

```text
① 生成 lockName 与 repeatFlagName
② 先读 Redis 成功标记，命中则拒绝
③ 尝试取得本地 ReentrantLock，失败则拒绝
④ 尝试取得 Redisson 公平锁，waitTime=0，失败则拒绝
⑤ 在分布式锁保护下，再查成功标记
⑥ proceed，继续后续通知与业务
⑦ durationTime>0 时，尝试写带 TTL 的 success 标记
⑧ finally 释放分布式锁，再释放本地锁
```

| 机制 | 在本段的作用 | 不能自动提供 |
| --- | --- | --- |
| 首次标记检查 | 已处理请求的快速判断 | 完整并发保护 |
| 本地锁 | 按 key 在当前 JVM 中减少重复竞争 | 跨 JVM 互斥 |
| 分布式公平锁 | 约定后端与 key 下的跨调用协调 | 顺序重复永远拒绝 |
| 再次标记检查 | 防止沿用获取保护前的旧判断 | 数据库与 Redis 的原子提交 |
| TTL 标记 | 一定时段内识别已正常返回 | 永久幂等或上次结果回放 |

本地缓存创建公平 ReentrantLock，但切面使用无参 tryLock，不应因此认定它严格按排队顺序执行。远程调用传 waitTime=0，也不表示绝对没有网络等待或不会抛异常。

## 9. 默认 durationTime=0 到底意味着什么？

注解声明：

```java
long durationTime() default 0L;
```

切面仅在正值时写成功标记：

```java
obj = joinPoint.proceed();
if (durationTime > 0) {
    // 尝试写 success，使用秒为单位的 TTL
}
```

所以对于没有已有成功标记的新 key：

- 执行重叠时仍可能受本地锁、分布式锁约束。
- 第一次结束并释放后，不会因为本次调用新增了成功标记而拒绝第二次，因为根本没新增。
- 顺序重复能否被业务状态检查等挡住，要进入业务方法看。

还要注意：durationTime=0 不代表删除已有标记。入口仍查询同名标记；若之前其他调用已写入且未过期，仍可能拒绝。

## 10. “正常返回”不自动等于“业务成功”

当前切面判断写标记的前提是 proceed 正常返回，没有继续检查返回对象的业务码。

| 业务表现 | 切面主线可能怎样处理 |
| --- | --- |
| 返回成功对象 | 正常返回，正 TTL 时尝试写标记 |
| 返回失败码，但没有抛异常 | 仍是正常返回，也可能写标记 |
| 抛异常并向外传播 | 不执行后面的正常写标记步骤 |
| 内部捕获失败再返回默认值 | 切面可能仍只观察到正常返回 |

这不是说所有返回失败都必须抛异常，而是成功定义需要双方契约一致。不能只靠注解名称替代业务结果判断。

proceed 还可能包含其他切面、事务。正常返回观察在哪一层发生，要结合第 04 课的实际代理链。

## 11. 失败状态表：最值得读的几条路径

| 情况 | 当前源码可确认的行为 | 后续重复请求的含义 |
| --- | --- | --- |
| 首次 Redis get 抛异常 | 此处不由写标记的 catch 吞掉，主线可能失败 | 不能概括为 Redis 错误一律放行 |
| 本地锁未取得 | 抛重复提示，不继续业务 | 并发被拒绝不表示业务已成功 |
| 分布式锁未取得 | 抛提示，finally 释放已取得的本地锁 | 结果不等于存在成功标记 |
| 锁内再查到 success | 拒绝，不执行此次业务 | 表示该标记范围内已正常处理过 |
| proceed 抛异常 | 后续写标记不执行，进入释放 | 是否留下业务效果要看实际操作与事务 |
| proceed 正常，写标记失败 | catch 记录日志，仍尝试返回业务结果并解锁 | 下次可能缺少成功识别状态 |
| 解锁又抛异常 | 可能改变最终异常或返回结果 | 业务可能已发生，不能据错误就断言没执行 |

这些路径不应全部叫“幂等失败”。应说清发生在哪一步、已有副作用是什么、是否可以安全重试。

## 12. 两个系统之间的时间间隙

### 业务已提交，成功标记尚未写入

```text
数据库业务提交 → 进程退出或标记写失败 → 重试又查不到标记
```

如果业务本身没有稳定状态、条件更新或唯一约束，可能再次产生效果。

### 标记已写，但更外层事务最终回滚

如果被调用方法只是参与外部事务，局部返回不等于最终提交。标记可能先存在，而业务最终回滚，导致重试被阻止。

### 有些副作用不在同一个事务里

远程退款、消息发送等也不一定随本地数据库事务回滚。异常抛出不等于所有已发生步骤都撤销。

因此不能只凭锁和一个 Redis success 标记，宣称数据库、支付和消息已经形成“恰好一次”的完整保障。

事务边界参考：[Spring 官方声明式事务说明](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)。具体项目仍要按真实传播与调用链验证。

## 13. 数据库层与业务状态可以怎样配合？

这里只介绍思路，不直接给项目改造方案：

- 用稳定业务操作标识约束重复记录，而不是每次重试换一个标识。
- 对状态变更设置前置条件，例如只有未取消状态才能执行取消对应的业务更新。
- 用数据库唯一约束、原子条件更新等，处理“检查不存在后同时插入”的竞争。
- 需要一起提交的本地业务与幂等记录，放在适当事务边界内处理。
- 跨系统副作用另行设计可识别的请求、重试与恢复协议。

简单的 select 后 insert，不会只因代码紧邻就变成原子整体；单独一张唯一表也不自动覆盖所有外部副作用。需要围绕目标业务不变量选择组合。

## 14. 对应两个真实业务入口

### ApiDataService.saveApiData

customize 服务使用：

```java
@RepeatExecuteLimit(name = ..., keys = {"#apiData.id"})
public void saveApiData(ApiData apiData) {
    ApiData existing = apiDataMapper.selectById(apiData.getId());
    if (existing == null) {
        apiDataMapper.insert(apiData);
    }
}
```

这是缩短变量与注解参数的阅读片段。未指定 durationTime，使用默认 0。因此顺序重投时，不能把避免重复插入完全归功于 Redis success 标记；方法内部还按 ID 查已有记录。

这段查询和插入在并发故障下是否可靠，还要结合锁的实际覆盖、数据库约束与消费者恢复。不能只看方法名就宣称恰好一次落库。

### OrderService.cancel

订单服务同时使用 RepeatExecuteLimit、ServiceLock 和 Transactional，并以订单号参与 key。

它们分别影响重复检查、业务互斥与事务，并非三个名字表达同一能力。是否安全退库存、更新订单，要继续追 updateOrderRelatedData 的状态判断与数据库写入。

本课只建立阅读方向，不凭注解就宣布整个订单取消已实现完整幂等。

## 15. 独立实验：七组顺序状态

下面仅用 JDK 17。模型不执行 AOP、不模拟锁竞争，也不连接 Redis 或数据库；它专门观察顺序重复、标记过期、正常失败返回和局部副作用。

Gate 提取“查标记 → 调业务 → 正 TTL 写标记”的顺序。时间手动推进，不用 sleep。捕获写入失败只是模拟源码这条路径；并未验证真实连接、TTL 或缓存可靠性。

最后一组订单状态模型只展示顺序重复效果，不保证并发更新、数据库事务或外部退款正确。

保存为 `RepeatAndIdempotencyDemo.java`，作为普通 main 运行。

```java
import java.util.function.Supplier;

public class RepeatAndIdempotencyDemo {
    static class Duplicate extends RuntimeException {}

    static class Gate {
        long now;
        long successUntil = -1;
        int businessCalls;
        boolean failMarkerWrite;

        boolean marked() {
            return now < successUntil;
        }

        String execute(long durationSeconds, Supplier<String> business) {
            if (marked()) throw new Duplicate();
            businessCalls++;
            String result = business.get();
            if (durationSeconds > 0) {
                try {
                    if (failMarkerWrite) throw new IllegalStateException("marker failed");
                    successUntil = now + durationSeconds * 1000;
                } catch (IllegalStateException ignored) {
                    // 只模拟忽略本次标记写入失败，不模拟日志和网络。
                }
            }
            return result;
        }
    }

    static String attempt(Gate gate, long seconds, Supplier<String> business) {
        try {
            return gate.execute(seconds, business);
        } catch (Duplicate duplicate) {
            return "DUPLICATE";
        } catch (IllegalStateException error) {
            return "ERROR:" + error.getMessage();
        }
    }

    static class OrderModel {
        boolean cancelled;
        int releaseEffects;

        String cancel() {
            if (cancelled) return "ALREADY_CANCELLED";
            cancelled = true;
            releaseEffects++;
            return "CANCELLED";
        }
    }

    public static void main(String[] args) {
        System.out.println("-- A: 默认零时长的顺序重复 --");
        Gate zero = new Gate();
        System.out.println("第一次=" + attempt(zero, 0, () -> "ok"));
        System.out.println("第二次=" + attempt(zero, 0, () -> "ok"));
        System.out.println("业务次数=" + zero.businessCalls);

        System.out.println("-- B: 正时长与过期 --");
        Gate ttl = new Gate();
        System.out.println("第一次=" + attempt(ttl, 60, () -> "ok"));
        System.out.println("第二次=" + attempt(ttl, 60, () -> "ok"));
        ttl.now += 61000;
        System.out.println("过期后=" + attempt(ttl, 60, () -> "ok"));
        System.out.println("业务次数=" + ttl.businessCalls);

        System.out.println("-- C: 失败码也是正常返回 --");
        Gate returnedFailure = new Gate();
        System.out.println("第一次=" + attempt(returnedFailure, 60, () -> "BUSINESS_ERROR"));
        System.out.println("第二次=" + attempt(returnedFailure, 60, () -> "ok"));
        System.out.println("已有标记=" + returnedFailure.marked());

        System.out.println("-- D: 标记写入失败 --");
        Gate markerFailure = new Gate();
        markerFailure.failMarkerWrite = true;
        System.out.println("第一次=" + attempt(markerFailure, 60, () -> "ok"));
        System.out.println("第二次=" + attempt(markerFailure, 60, () -> "ok"));
        System.out.println("业务次数=" + markerFailure.businessCalls);

        System.out.println("-- E: 业务异常后再尝试 --");
        Gate failed = new Gate();
        System.out.println("第一次=" + attempt(failed, 60, () -> {
            throw new IllegalStateException("before effect");
        }));
        System.out.println("第二次=" + attempt(failed, 60, () -> "ok"));
        System.out.println("业务次数=" + failed.businessCalls);

        System.out.println("-- F: 已有副作用再抛异常 --");
        Gate partial = new Gate();
        int[] effects = {0};
        System.out.println("第一次=" + attempt(partial, 60, () -> {
            effects[0]++;
            throw new IllegalStateException("after effect");
        }));
        System.out.println("第二次=" + attempt(partial, 60, () -> {
            effects[0]++;
            return "ok";
        }));
        System.out.println("累计副作用=" + effects[0]);

        System.out.println("-- G: 业务状态识别顺序重复 --");
        OrderModel order = new OrderModel();
        System.out.println("第一次=" + order.cancel());
        System.out.println("第二次=" + order.cancel());
        System.out.println("释放效果次数=" + order.releaseEffects);
    }
}
```

预期输出：

```text
-- A: 默认零时长的顺序重复 --
第一次=ok
第二次=ok
业务次数=2
-- B: 正时长与过期 --
第一次=ok
第二次=DUPLICATE
过期后=ok
业务次数=2
-- C: 失败码也是正常返回 --
第一次=BUSINESS_ERROR
第二次=DUPLICATE
已有标记=true
-- D: 标记写入失败 --
第一次=ok
第二次=ok
业务次数=2
-- E: 业务异常后再尝试 --
第一次=ERROR:before effect
第二次=ok
业务次数=2
-- F: 已有副作用再抛异常 --
第一次=ERROR:after effect
第二次=ok
累计副作用=2
-- G: 业务状态识别顺序重复 --
第一次=CANCELLED
第二次=ALREADY_CANCELLED
释放效果次数=1
```

观察 F：这里用普通内存计数模拟不会随该异常自动撤销的副作用，不声称所有真实数据库操作都不会回滚。观察 G：第二次返回不同，但所约定的释放效果没有重复，说明响应完全相同不是幂等的唯一判断。

验证记录：本地 JDK 25 使用 `--source 17` 运行，七组实际输出与讲义一致。没有执行真实 AOP、锁竞争、Redis TTL、数据库事务或远程业务操作。

## 16. 源码阅读与验证清单

| 问题 | 去哪里确认 |
| --- | --- |
| 重试是否使用稳定标识 | 调用方请求/事件 ID、注解 name 与 keys |
| 是否经由代理 | 外部入口、自调用与容器对象 |
| 两个调用是否竞争同一保护范围 | 完整锁名、后端、锁类型 |
| 查标记发生几次 | RepeatExecuteLimitAspect 的获取前与获取后 |
| 标记何时写、保留多久 | proceed 返回后、durationTime、RedissonDataHandle |
| “成功”怎样定义 | 是否抛异常、是否检查返回码、事务是否最终完成 |
| 数据库是否自己识别重复 | 状态条件、唯一约束、持久化记录与事务 |
| 失败可否重试 | 已发生副作用、状态可见性与恢复协议 |

独立模型用于理解顺序。真实并发还需要可控的多线程/多客户端实验，事务和跨系统效果也需要相应环境验证，不能靠一次打印结果证明全部正确。

## 17. 练习

1. 同一个操作顺序重复两次，为什么单纯加锁可能无效？
2. 业务幂等是否要求代码绝不再执行、响应永远一模一样？
3. 第一次已经成功但响应丢失，客户端超时是否证明没有副作用？
4. 每次重试都生成新幂等键，能否识别同一操作？
5. 仅用 userId 作为键有什么风险？
6. 相同 key 但金额不同，是否都可以直接当作合法重试？
7. 只在锁外查一次 success，为什么可能不够？
8. 本地锁能代替跨 JVM 的分布式锁吗？
9. 默认 durationTime=0，第一次结束后是否必然有新增成功标记？
10. durationTime=0 是否代表忽略或删除已有标记？
11. 业务返回失败码不抛异常，当前切面会自动跳过写标记吗？
12. proceed 抛异常，后面的正常写标记步骤是否继续？
13. 没有成功标记是否就能证明业务完全没发生？
14. 当前写标记失败，是否自动回滚已经完成的业务？
15. 正 TTL 的标记存在，能否表示永远不会再执行？
16. 一个数据库事务能否自动回滚 Redis 和远程退款？
17. 内层方法返回是否必定表示更外层事务已提交？
18. ApiDataService 默认零时长，顺序重投时还要读哪段逻辑？
19. 查询不存在再插入，是否仅因两行代码相邻就有并发唯一性？
20. 本课模型验证了真实锁竞争、Redis TTL 或数据库回滚吗？

## 18. 参考答案

### 1. 锁只覆盖持有期间

第一次结束释放后，第二次可以重新取得锁。需要另一份已处理状态或业务约束识别顺序重复。

### 2. 幂等关注效果

不是要求零重复执行或相同响应，主要关注相同约定操作的重复请求是否产生符合一次处理含义的业务效果。日志和提示可能不同。

### 3. 超时不证明未执行

服务可能已完成，只是响应未送达。重试要结合稳定标识与已处理状态，不能因本地超时直接当作从未执行。

### 4. 重试换 key

不能可靠识别同一操作，系统可能把每次请求看成新业务。key 的稳定范围需要与操作身份一致。

### 5. userId 粒度过大

可能把同一用户不同订单或不同操作混成重复，既影响并发，也可能错误拒绝合法业务。

### 6. 相同 key 不同内容

不能无条件当合法重试，应按协议检查冲突。当前切面没有通用内容指纹或旧结果回放能力。

### 7. 获取后再查

首次查询可能已经过时，其他调用在这段时间完成并写标记。取得保护后再次检查用于缩小这个判断间隙。

### 8. 本地范围

不能直接代替。不同进程各有自己的本地锁，分布式协调要看共同后端与 key；业务层还可能需要数据库约束。

### 9. 默认不新增标记

不会由当前正常返回路径新增，写入要求 durationTime>0。不能把默认行为讲成结束后持续缓存成功。

### 10. 既有标记仍检查

不代表忽略或删除，入口依然查询。若已存在同名 success 且有效，仍可能拒绝。

### 11. 失败码与正常返回

当前不会自动检查业务码，正常返回仍可能写标记。双方对成功的定义需要一致。

### 12. 异常后的语句

未处理异常中断这条正常主线，不执行后面的写标记；finally 释放仍按实际结构进行。

### 13. 无标记不等于无副作用

可能业务已提交但标记未写，也可能部分外部效果已发生后抛异常。要按时间点确认实际状态。

### 14. 标记写失败

当前只是记录异常，没有自动撤销业务。下一次缺标记可能再次进入，需业务自身识别与约束。

### 15. TTL 范围

不能保证永久。过期、丢失或写入未成功后，标记不再提供相同识别能力。

### 16. 跨系统事务

普通本地数据库事务不会自动覆盖 Redis、远程退款和消息。要分别设计一致性与恢复机制。

### 17. 内层返回与提交

不一定，参与外部事务时最终提交由更外层边界决定。标记的时间与业务提交需分别分析。

### 18. 实际落库判断

继续看 selectById 与未存在时 insert，以及数据库约束、代理锁是否真正覆盖。不能只归功于默认不会写入的标记。

### 19. 检查与插入

不是自动原子操作，可能有并发间隙。需要对应的数据库约束、条件操作、事务及协调方案支持。

### 20. 模型范围

没有。只验证顺序条件、手动时间与 Java 异常/返回语义，真实锁、Redis、数据库和跨进程行为尚需集成验证。

## 19. 本课通关与下一课

选择一次“取消订单后响应丢失再重试”，分别说出锁、成功标记与数据库状态各自能解决什么，在哪些步骤之间仍可能不一致。

下一课学习布隆过滤器基础，解释位数组、多个哈希、误判率、初始化与数据加载，为 BloomFilterHandler 源码做准备。

继续阅读：[第 07 课：布隆过滤器基础（含答案）](damai-redisson-framework-第07课-布隆过滤器基础（含答案）.md)。
