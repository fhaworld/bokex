---
title: "redisson应用-第08课-延迟队列与消费基础（含答案）"
description: "redisson应用系列第08课，主题：延迟队列与消费基础（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 08 课：延迟队列与消费基础（含答案）

适用基础：Java、Stream、Spring Boot；已学习前七课。本课先补齐队列、线程池与消费生命周期知识，为第 15、16 课逐行阅读延迟队列模块做准备。

前一课：[布隆过滤器基础](damai-redisson-framework-第07课-布隆过滤器基础（含答案）.md)。总进度见[课程导航](damai-redisson-framework-课程学习导航.md)。

## 1. 本课要回答的问题

学完以后，你应能独立回答：

1. 延迟时间到了，为什么业务可能还没有执行？
2. 消息被 `take()` 取走后，线程池拒绝接收会怎样？
3. 消费异常、线程中断、服务重启，分别需要检查什么？
4. 两个线程消费同一个队列，是竞争还是广播？
5. 如何从 `DelayProduceQueue` 追到 `ConsumerTask.execute()`？

先建立一条判断原则：**到期、取出、提交、执行成功，是四个不同的状态。**

## 2. 从“订单超时取消”理解延迟消息

假设创建订单时约定 15 分钟后检查是否应取消。这里的 15 分钟是教学场景，不代表项目当前配置。

最直观的写法是启动一个线程，`sleep(15 分钟)`，然后取消订单。它会把等待生命周期绑在本地线程和进程上；订单越多，管理成本越高，进程退出后也需要恢复机制。

延迟队列把“未来要做的事情”表示为一条消息：

```text
消息内容：订单号
延迟要求：15 分钟后允许消费
到期后：重新读取订单状态，判断能否取消
```

队列负责安排消息进入可消费状态；订单服务负责判断业务条件并完成状态变更。即使消息按时到达，也不能只凭消息内容断言订单仍然未支付。

本仓库的 `DelayOrderCancelConsumer.execute()` 将消息解析为 DTO，再调用 `orderService.cancel()`。取消的具体状态约束要继续进入订单服务阅读，不能从消费者类名推断已经正确实现。

源码入口：[订单取消消费者](../damai-server/damai-order-service/src/main/java/com/damai/service/delayconsumer/DelayOrderCancelConsumer.java)。

## 3. 延迟队列和 Redis TTL 有什么不同

| 对比项 | 延迟消息 | 键 TTL |
| --- | --- | --- |
| 主要目标 | 将任务安排到未来处理 | 使数据在过期后不可用并被清理 |
| 到期后希望看到什么 | 消息可被消费者处理 | 键不再作为有效数据存在 |
| 是否自动执行业务方法 | 否，需要消费者 | 否 |
| 能否单凭这个机制证明业务成功 | 不能 | 不能 |

不要把“设置一个过期键”直接等同于“获得可靠的超时订单处理系统”。如果采用键空间通知等方案，还需要单独分析通知订阅、断线恢复、持久化与补偿能力；本模块当前入口是 Redisson 的延迟队列 API。

## 4. 沿着时间线区分四个时刻

```text
t0：生产者调用 offer(content, delay, unit)
 │
 │ 等待到期
 ▼
t1：消息到期，具备转移到目标队列的条件
 │ 转移、网络、调度可能增加时间
 ▼
t2：消费者通过 take() 取得消息
 │ 提交执行线程池；可能排队，也可能被拒绝
 ▼
t3：业务任务开始执行
 │ 数据库、网络、锁、业务判断都可能耗时或失败
 ▼
t4：业务任务完成
```

这里多列出“开始执行”和“完成”，是为了避免把 `execute()` 提交任务与任务内部执行混淆。延迟参数不是业务完成时间的承诺，也不适合承担严格实时截止保证。

不能仅根据 `offer()` 正常返回，推导出未来必然业务成功。可靠性还取决于服务可用性、Redis 持久化与故障转移、消费者处理方式，以及业务补偿。

## 5. 本项目有三处不同用途的“队列”

```text
生产者
  │ delayedQueue.offer(...)
  ▼
① 延迟暂存结构：等待到期
  │ 到期转移
  ▼
② Redis 目标阻塞队列：等待消费者 take()
  │ 监听线程取出并提交 Runnable
  ▼
③ JVM 工作线程池的任务队列：等待业务线程执行
  │
  ▼
ConsumerTask.execute(content)
```

① 是逻辑用途描述，不表示 Redisson 底层只用一个 Redis key。第 19 课再按项目使用的 Redisson **3.32.0** 阅读实际数据结构与转移机制。

② 由 `redissonClient.getBlockingQueue(relTopic)` 获得。③ 是当前 Java 进程中的 `LinkedBlockingQueue<Runnable>`。Redis 中已经取出的消息，不会因为 JVM 队列尚未处理而自动留在原 Redis 队列里。

特别注意：本模块使用的 `RDelayedQueue` / `RBlockingQueue` 组合，不能直接套用其他队列产品或新版 Reliable Queue 的 ACK、重试、可见性超时语义。阅读[Redisson 队列文档](https://redisson.pro/docs/data-and-services/queues/)时，要核对具体对象与版本。

## 6. `take()` 到底做了什么

先用 JDK 阻塞队列建立基础模型：

| 操作 | 队列非空 | 队列为空 |
| --- | --- | --- |
| `peek()` | 查看队头，不移除 | 返回 `null` |
| `poll()` | 取得并移除队头 | 返回 `null` |
| `take()` | 取得并移除队头 | 阻塞等待，可响应中断 |

`take()` 的关键是**取出并移除**。它没有承诺消息对应的数据库修改已经完成，也没有天然提供“业务失败后自动恢复到原队列”。以上方法语义可查 [Java 17 BlockingQueue 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/BlockingQueue.html)。

项目的队列类型是 Redisson `RBlockingQueue<String>`，包含远程访问行为；下面的本地实验只验证 Java 队列基础，不模拟其全部网络与故障行为。

同一个队列上的多个消费者通常是竞争取出消息，并不是每个消费者都收到一份副本。需要广播时，应明确选择对应的发布订阅或其他消息模型。

## 7. 为什么消费者使用两个线程池

当前 `DelayConsumerQueue` 创建了两个线程池：

| 线程池 | 工作内容 | 当前配置特点 |
| --- | --- | --- |
| `listenStartThreadPool` | 循环 `take()`，提交业务任务 | 核心与最大线程数均为 1，任务队列未显式设容量 |
| `executeTaskThreadPool` | 运行 `consumerTask.execute(content)` | 默认核心与最大线程数均为 4，任务队列容量 256 |

这让监听线程可以继续取消息，而业务线程处理前面的任务。但业务处理慢时，压力会从 Redis 队列转移到 JVM 工作队列；本地队列也会满。

不要把 `corePoolSize=4` 理解为构造线程池时必然立即启动了 4 个线程。当前没有看到预启动所有核心线程的调用，线程按提交任务等条件创建。

配置见：[DelayQueueProperties](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/config/DelayQueueProperties.java)。

## 8. 线程池如何接收任务、何时拒绝

对本项目使用的普通 `ThreadPoolExecutor`，理解下面的顺序：

1. 工作线程数少于核心线程数时，尝试创建线程处理任务。
2. 达到核心线程数后，优先尝试放入工作队列。
3. 队列放不下时，尝试增加线程，不能超过最大线程数。
4. 仍无法接收，或线程池已关闭，就进入拒绝策略。

具体接收过程还要处理线程池状态变化等并发情况。规则及默认拒绝策略见 [ThreadPoolExecutor 官方文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)。

当前构造器未传自定义拒绝策略，默认 `AbortPolicy` 会抛出 `RejectedExecutionException`。

默认核心和最大线程数都是 4，因此工作队列满后不能再额外扩出第 5 个业务线程。这里的容量是**每个消费者对象的工作队列容量**，不是整个系统所有待执行订单的总数。

## 9. 最需要追踪的失败窗口

当前消费主线可缩写成以下伪代码，省略了日志与生命周期处理：

```java
String content = blockingQueue.take();
executeTaskThreadPool.execute(() -> {
    try {
        consumerTask.execute(content);
    } catch (Exception e) {
        log.error("consumer execute error", e);
    }
});
```

逐行追踪消息所在位置：

| 时刻 | 消息或任务在哪里 | 当前代码能说明什么 |
| --- | --- | --- |
| `take()` 前 | Redis 目标队列 | 尚未被本次监听取出 |
| `take()` 后、提交前 | 监听线程局部变量 | 已离开目标队列 |
| 提交成功、执行前 | JVM 任务队列或工作线程 | 不代表业务完成 |
| 业务抛异常 | 当前任务的异常处理路径 | 内层捕获 `Exception` 后记录日志，无显式重试 |
| 提交被拒绝 | 外层异常处理路径 | 外层捕获并记录日志，无显式重新入队 |

因此，消息可能已经从 Redis 取出，却没有完成业务。不能把当前实现称为“端到端至少一次”或“恰好一次”保障。

补偿思路包括持久化任务状态、具有确认与恢复机制的队列、失败重试与上限、业务定时扫描等；选择哪一种要结合故障模型。**重试还会带来重复执行的可能，所以第 06 课的幂等仍然必要。** 单独加一把锁不能恢复已丢失的任务。

## 10. 有序入队不等于有序完成

即便某个队列按 A、B 的顺序取出，两条任务也可能交给不同业务线程：

```text
A：先取出 → 开始执行 → 等数据库锁 ─────────→ 完成
B：后取出 → 开始执行 → 很快完成
```

结果是 B 先完成。多个分区还会引入多个目标队列，更不能据此推导全局顺序。

如果同一订单的操作必须遵循特定顺序，通常要结合消息路由、串行处理或业务状态机设计。这里的队列框架本身不能替代订单状态约束。

## 11. 中断和关闭：一个容易看错的循环

当前代码的重要片段：

```java
while (!Thread.interrupted()) {
    try {
        String content = blockingQueue.take();
        // 提交任务……
    } catch (InterruptedException e) {
        destroy(executeTaskThreadPool);
    } catch (Throwable e) {
        // 记录日志……
    }
}
```

必须认识三个语义：

- `Thread.interrupted()` 检查当前线程中断标志，**同时清除标志**。
- `Thread.currentThread().isInterrupted()` 查询标志，不清除。
- `InterruptedException` 的典型阻塞操作路径会清除标志；捕获异常后不能假设标志仍为 true。

因此，不能简单断言“捕获中断异常后，下次 while 一定退出”。当前 catch 没有 `break`、`return` 或恢复中断标志，在中断标志已清除的路径上可能继续循环。基础语义见 [Thread.interrupted() 官方文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Thread.html#interrupted())。

常见停止方案是在捕获中断后恢复标志并退出循环，再统一清理资源。但这是待设计的改进方向，不是当前代码已经做了的事；本课只写讲义，不修改业务源码。

`destroy(executorService)` 实际调用的是传入线程池的 `shutdown()`。它不等于关闭整个消费者：

- `shutdown()` 停止接收新任务，让已提交任务继续处理，不会默认中断正在执行的任务。
- `shutdownNow()` 尝试中断正在执行的任务，也不保证任务立即停止，更不代表远程业务自动回滚。
- 需要根据生命周期管理监听线程池、业务线程池、阻塞等待与未完成任务，并考虑等待终止的上限。

JDK 的 `BlockingQueue` 也没有统一的内置“关闭队列”操作。不要把关闭线程池与关闭 Redis 客户端、停止消费者、删除远程队列混为一谈。

## 12. 对照当前项目的调用链

先按下面顺序阅读，不急着钻进 Redisson 内部：

| 顺序 | 源码入口 | 先找什么 |
| --- | --- | --- |
| 1 | [DelayQueueContext](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/context/DelayQueueContext.java) | `sendMessage()` 如何按 topic 获取生产组合 |
| 2 | [DelayQueueProduceCombine](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/context/DelayQueueProduceCombine.java) | `topic + "-" + i` 与分区选择 |
| 3 | [DelayProduceQueue](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/core/DelayProduceQueue.java) | 延迟对象如何包装目标阻塞队列，`offer()` 参数 |
| 4 | [DelayBaseQueue](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/core/DelayBaseQueue.java) | 相同 relTopic 如何定位目标队列 |
| 5 | [DelayQueueInitHandler](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/event/DelayQueueInitHandler.java) | 启动事件、发现 `ConsumerTask`、按分区创建消费者 |
| 6 | [DelayConsumerQueue](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/core/DelayConsumerQueue.java) | `take()`、线程池提交、异常和停止路径 |
| 7 | [ConsumerTask](../damai-redisson-framework/damai-service-delay-queue-framework/src/main/java/com/damai/core/ConsumerTask.java) | `topic()` 与 `execute(String content)` 两个业务契约 |

生产端和消费端最终队列名必须对应。基础 topic 一致但分区后缀、环境前缀或分区数量不一致，都需要进一步分析消息会被哪个消费者处理。

默认分区数为 5，启动处理器针对每个 `ConsumerTask` 创建这些分区对应的消费者对象；每个对象有自己的两套线程池配置。线程池数量与实际已经创建的线程数量仍要区分。

`listenStart()` 的 `synchronized` 与 `runFlag` 只约束同一个消费者对象，不是跨 JVM 的全局单例消费锁。多个实例读取同一目标队列时仍要按竞争消费理解。

第 15 课会仔细检查分区选择器的边界，第 16 课检查启动标记、消费者引用与停止生命周期。本课先记下问题，不把方法名当成实现保证。

## 13. 六组可运行实验

实验包含一个手动时钟教学模型，以及真实 JDK 队列、线程池和中断操作。**不连接 Redis，不是 Redisson 实现的复刻，也不证明真实消息可靠性。**

使用 `CountDownLatch` 控制先后关系，无须用任意 `sleep()` 猜线程调度。为避免异常时挂住，等待均设置上限。

保存为 `DelayQueueBasicsDemo.java`，使用 JDK 17 或更高版本：

```shell
java --source 17 DelayQueueBasicsDemo.java
```

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class DelayQueueBasicsDemo {
    record Message(long due, String body) {}

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    static void await(CountDownLatch latch) throws InterruptedException {
        check(latch.await(5, TimeUnit.SECONDS), "等待超时");
    }

    static void finish(ExecutorService pool) throws InterruptedException {
        pool.shutdown();
        if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
            pool.shutdownNow();
            throw new AssertionError("线程池未按预期结束");
        }
    }

    public static void main(String[] args) throws Exception {
        // A：手动时钟模型。到期只转移，不执行任何订单业务。
        PriorityQueue<Message> delayed = new PriorityQueue<>(
                Comparator.comparingLong(Message::due));
        Queue<String> ready = new ArrayDeque<>();
        delayed.add(new Message(100, "order-1"));
        long now = 99;
        while (!delayed.isEmpty() && delayed.peek().due() <= now) {
            ready.add(delayed.remove().body());
        }
        System.out.println("A 到期前可取=" + ready.poll());
        now = 100;
        while (!delayed.isEmpty() && delayed.peek().due() <= now) {
            ready.add(delayed.remove().body());
        }
        System.out.println("A 到期后就绪数=" + ready.size() + "，业务完成数=0");

        // B：take 已移除元素，但没有调用任何业务方法。
        BlockingQueue<String> source = new LinkedBlockingQueue<>();
        source.add("order-2");
        String taken = source.take();
        System.out.println("B 取出=" + taken + "，原队列为空=" + source.isEmpty());

        // C：一个忙碌线程 + 一个已排队任务，下一次提交确定被拒绝。
        ThreadPoolExecutor single = new ThreadPoolExecutor(1, 1, 0,
                TimeUnit.SECONDS, new LinkedBlockingQueue<>(1));
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger completed = new AtomicInteger();
        try {
            single.execute(() -> {
                started.countDown();
                try {
                    await(release);
                    completed.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            await(started);
            single.execute(completed::incrementAndGet);
            source.add("order-3");
            String removed = source.take();
            boolean rejected = false;
            try {
                single.execute(() -> {
                    check(removed.equals("order-3"), "消息不匹配");
                    completed.incrementAndGet();
                });
            } catch (RejectedExecutionException e) {
                rejected = true;
            }
            check(rejected, "应拒绝第三个任务");
            System.out.println("C 提交被拒绝=" + rejected
                    + "，原队列为空=" + source.isEmpty());
        } finally {
            release.countDown();
            finish(single);
        }
        check(completed.get() == 2, "只有前两个任务应完成");
        System.out.println("C 已完成任务数=" + completed.get());

        // D：先提交 A，再提交 B；控制 B 一定先完成。
        ExecutorService pair = Executors.newFixedThreadPool(2);
        CountDownLatch aStarted = new CountDownLatch(1);
        CountDownLatch releaseA = new CountDownLatch(1);
        List<String> completionOrder = new CopyOnWriteArrayList<>();
        try {
            Future<?> a = pair.submit(() -> {
                aStarted.countDown();
                try {
                    await(releaseA);
                    completionOrder.add("A");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            await(aStarted);
            Future<?> b = pair.submit(() -> completionOrder.add("B"));
            b.get(5, TimeUnit.SECONDS);
            releaseA.countDown();
            a.get(5, TimeUnit.SECONDS);
            check(completionOrder.equals(List.of("B", "A")), "完成顺序错误");
            System.out.println("D 提交顺序=[A, B]，完成顺序=" + completionOrder);
        } finally {
            releaseA.countDown();
            finish(pair);
        }

        // E：JDK 阻塞队列抛 InterruptedException 后，中断标志已清除。
        Thread.currentThread().interrupt();
        try {
            new LinkedBlockingQueue<String>().take();
            throw new AssertionError("应响应中断");
        } catch (InterruptedException e) {
            System.out.println("E catch中中断标志="
                    + Thread.currentThread().isInterrupted());
            System.out.println("E 原循环条件允许继续=" + !Thread.interrupted());
        } finally {
            Thread.interrupted();
        }

        // F：shutdown 返回时，已经开始的任务仍可未完成。
        ExecutorService shutdownPool = Executors.newSingleThreadExecutor();
        CountDownLatch running = new CountDownLatch(1);
        CountDownLatch releaseRunning = new CountDownLatch(1);
        try {
            Future<?> task = shutdownPool.submit(() -> {
                running.countDown();
                try {
                    await(releaseRunning);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError("shutdown 不应中断此任务", e);
                }
            });
            await(running);
            shutdownPool.shutdown();
            check(!task.isDone(), "任务应仍被闩锁阻塞");
            System.out.println("F 已调用shutdown=" + shutdownPool.isShutdown()
                    + "，任务已完成=" + task.isDone());
            releaseRunning.countDown();
            task.get(5, TimeUnit.SECONDS);
        } finally {
            releaseRunning.countDown();
            finish(shutdownPool);
        }
    }
}
```

预期输出：

```text
A 到期前可取=null
A 到期后就绪数=1，业务完成数=0
B 取出=order-2，原队列为空=true
C 提交被拒绝=true，原队列为空=true
C 已完成任务数=2
D 提交顺序=[A, B]，完成顺序=[B, A]
E catch中中断标志=false
E 原循环条件允许继续=true
F 已调用shutdown=true，任务已完成=false
```

A 使用逻辑时间 99、100，不表示真实毫秒，也没有真实定时器。C 用容量 1 放大项目中的有界队列行为；项目默认容量是 256。E 验证 JDK 中断语义，不能据此声称已经测试远程 Redisson 中断的所有路径。

验证记录（2026-11-03）：从本 Markdown 提取完整 Java 示例，使用 OpenJDK 25.0.2、`--source 17` 运行成功，标准输出与上述预期逐行一致；本课本地链接及代码围栏检查通过。未进行 Redis 或订单服务集成测试。

## 14. 源码阅读练习

打开 `DelayConsumerQueue.listenStart()`，给每条路径做标记：

```text
正常：take → execute提交 → ConsumerTask.execute → 返回
饱和：take → execute拒绝 → 外层catch(Throwable) → 记录日志
失败：take → 提交成功 → 业务Exception → 内层catch → 记录日志
中断：take抛InterruptedException → 业务池shutdown → 再检查循环条件
```

然后回答三个定位问题：哪里将失败消息显式重新入队？哪里记录可恢复的业务执行状态？哪里保存所有消费者并统一停止？当前相关片段没有给出这些保障，应沿完整装配与业务链继续核实，而不是脑补框架会自动处理。

## 15. 自测题

1. 延迟队列和给 Redis key 设置 TTL，业务目标有何不同？
2. 到期是否说明订单取消已经完成？
3. 本项目三处队列分别等待什么？
4. `peek()`、`poll()`、`take()` 最重要的区别是什么？
5. `take()` 返回后，消息是否仍留在目标队列等待业务确认？
6. 同一个队列被两个实例消费，是否每个实例都收到每条消息？
7. 两个线程池分别负责什么？
8. 默认 core=max=4、队列容量 256，队列满后还能扩到第 5 个业务线程吗？
9. 当前业务线程池没有指定拒绝策略，会发生什么？
10. 消息被取出后，提交被拒绝，当前代码显式做了什么恢复？
11. 业务抛出 `Exception`，是否会自动重新入队？
12. 给业务加一把分布式锁，能否恢复已经丢失的消费任务？
13. 为什么有重试也需要幂等？
14. A 先于 B 被取出，为什么 B 可以先完成？
15. `Thread.interrupted()` 与 `isInterrupted()` 有什么区别？
16. 捕获中断异常后，为什么当前循环可能继续？
17. `shutdown()` 返回是否表示所有任务完成？
18. 当前 `runFlag` 能否保证整个集群只有一个消费者？
19. 生产和消费要匹配哪些名称或配置？
20. 六组实验实际验证了什么，未验证什么？

## 16. 参考答案

### 1. 延迟与 TTL

延迟队列安排未来处理消息；TTL 管理数据的有效期与清理。两者都不直接证明业务方法已执行成功。

### 2. 到期与完成

不说明。到期后还要转移、取出、提交、调度及执行业务；任一阶段都可能延迟或失败。

### 3. 三处队列

延迟暂存结构等待到期，Redis 目标队列等待取出，JVM 工作队列等待业务线程处理。

### 4. 队列方法

`peek()` 查看不移除，`poll()` 取出并移除且空时返回 null，`take()` 取出并移除且空时阻塞。

### 5. 取出后的消息

普通阻塞队列的 take 是移除操作。当前组合没有展示业务 ACK 后才移除目标消息的协议。

### 6. 多消费者

竞争消费，不是广播。还应把网络异常等故障情况下的结果不确定性与正常竞争语义分开分析。

### 7. 两套线程池

监听池循环取消息、提交任务；业务池执行业务。监听继续取消息可能使积压进入本地工作队列。

### 8. 扩容上限

不能，最大线程数为 4。达到接收上限时进入拒绝路径，不能只看队列容量而忽略线程池状态。

### 9. 默认拒绝

使用 AbortPolicy，抛出 RejectedExecutionException。关闭后的提交也可能触发拒绝。

### 10. 拒绝恢复

外层捕获 Throwable 并记录日志，没有在该路径显式重新入队或持久化补偿任务。

### 11. 业务异常

内层捕获 Exception 并记录日志，没有显式重试。业务返回正常但表示失败的结果，也要另外检查业务代码怎样处理。

### 12. 锁与恢复

不能。锁管理竞争与互斥，不负责把丢失任务重新生成或恢复。

### 13. 重试与幂等

上次可能已经部分或全部生效，但调用方没拿到成功结果；重试可能重复执行，必须由业务控制重复副作用。

### 14. 完成顺序

多个工作线程并发执行，各任务耗时不同；分区还会增加并行链路。取出顺序不能直接推导完成顺序。

### 15. 中断查询

静态 Thread.interrupted() 检查并清除当前线程标志；实例 isInterrupted() 查询目标线程标志而不清除。

### 16. 中断后继续

阻塞操作抛出中断异常时标志可能已清除；当前 catch 没有退出或恢复标志，下一轮条件可能再次成立。

### 17. 关闭与完成

不表示。shutdown 发起有序关闭，已提交任务可以继续运行，需要另行等待并处理超时。

### 18. 启动标记范围

不能。它是消费者对象自己的状态；synchronized 也是对象级约束，其他对象或 JVM 不共享这把监视器锁。

### 19. 名称与配置

核对基础 topic、环境前缀、分区后缀及分区数量等，最终两端必须定位到相应目标队列。

### 20. 实验范围

验证手动时钟模型、JDK take 移除、线程池饱和拒绝、并发完成顺序、中断标志和 shutdown 行为。没有验证 Redis、Redisson 远程转移、持久化、宕机恢复、集群故障或订单业务一致性。

## 17. 本课通关与下一课

不看答案，画出“延迟暂存 → Redis 目标队列 → JVM 工作队列 → 业务执行”的链路。在取出、提交和业务执行之间分别标出失败窗口，并解释为何日志不等于恢复。

下一课：[第 09 课：启动与公共底座（含答案）](damai-redisson-framework-第09课-启动与公共底座（含答案）.md)。我们会从 Maven 模块、自动配置导入、配置属性和 RedissonClient 装配开始，建立后续读锁、布隆与延迟队列源码的共同入口。
