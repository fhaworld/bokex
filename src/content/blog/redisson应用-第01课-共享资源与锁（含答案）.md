---
title: "redisson应用-第01课-共享资源与锁（含答案）"
description: "redisson应用系列第01课，主题：共享资源与锁（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 01 课：共享资源、Java 锁与分布式锁（含答案）

## 1. 本课目标

你已有 Java、Stream 与 Spring Boot 基础。学习 Redisson 前，先解决三个问题：**保护什么、谁在竞争、怎样让竞争者遵守同一条规则？**

这一课先用普通 Java 讲清竞态、临界区、锁对象、可重入和释放，再理解本地锁与分布式锁的边界。暂不深入 AQS、Redis Lua 或 watchdog 实现。

学完后应能解释：为什么给一段代码加了锁仍可能没有保护到目标资源；为什么两个服务各有本地锁仍可能冲突；为什么取得锁、业务完成和释放锁是三个不同事件。

课程总入口：[Redisson Framework 学习导航](damai-redisson-framework-课程学习导航.md)。

## 2. 共享资源不只是一块 Java 内存

两个执行者都能影响同一个状态时，就需要考虑共享资源。

| 场景 | 执行者 | 共享资源 |
| --- | --- | --- |
| 两个线程扣减库存 | 同一 JVM 内的线程 | 同一个对象中的库存字段 |
| 两个订单服务处理同一订单 | 两个 JVM 进程 | 数据库中的同一订单 |
| 两个消费者处理同一业务事件 | 不同线程或进程 | 事件对应的业务状态 |

“对象是不同的”不表示“资源不同”。两个服务拿到不同的订单 DTO，也可能同时更新数据库中同一行。

反过来，两个不同订单通常不必因为都使用同一个 Java 方法就竞争一把全局锁。锁保护的业务范围需要与资源一致。

## 3. 一张票为什么能被卖两次？

假设库存为 1，逻辑为：

```java
int before = stock.get();
if (before > 0) {
    stock.set(before - 1);
    sold.incrementAndGet();
}
```

即使 stock 是 AtomicInteger，get 与 set 各自安全，也不表示它们与判断组成的整段逻辑不可分割。

可能出现：

| 时刻 | 线程 A | 线程 B |
| --- | --- | --- |
| 1 | 读到库存 1 | |
| 2 | | 读到库存 1 |
| 3 | 判断可以售出 | |
| 4 | | 判断可以售出 |
| 5 | 写入 0，记录售出 | |
| 6 | | 根据旧值写入 0，再记录售出 |

结果可能是库存 0，但记录了两次售出。没有负数不代表业务正确。

这种结果依赖多个执行者的交错顺序，属于竞态问题。问题在“读、判断、更新”之间被穿插，而不只是某一条加减语句。

AtomicInteger 的条件更新、数据库条件更新等也能用于解决特定问题；本课先用锁理解如何保护一段复合操作，不把锁当成唯一答案。

## 4. 临界区：需要一起保护的那段逻辑

在这个例子中，临界区包括读取、判断和写入，而不是只锁住最后一次 set。

```java
lock.lock();
try {
    int before = stock.get();
    if (before > 0) {
        stock.set(before - 1);
        sold.incrementAndGet();
    }
} finally {
    lock.unlock();
}
```

在所有相关线程都使用同一把锁的前提下，其他线程不能同时进入这段由该锁保护的临界区。它需要等前一个持有者释放，再读取最新状态。

两个范围都要想清楚：

- 太小：关键的检查仍在锁外，不能保证检查与更新的一致性。
- 太大：无关资源也互相等待，可能降低并发能力。

数据库操作还有事务与隔离语义，不能把内存示例直接等同于完整的分布式扣库存方案。

## 5. synchronized 和 ReentrantLock 先怎样理解？

| 对比 | synchronized | ReentrantLock |
| --- | --- | --- |
| 使用方式 | 关键字，围绕对象监视器 | 显式锁对象与方法 |
| 常见互斥范围 | 使用同一监视器的线程 | 使用同一锁实例的线程 |
| 释放 | 正常离开或异常退出对应同步块时释放 | 通常由 finally 显式 unlock |
| 获取方式 | 进入同步块 | lock、tryLock、可中断获取等 |
| 可重入 | 支持 | 支持 |

不要只按“哪个更高级”选择。先理解是否需要尝试获取、等待上限、中断响应等具体能力。

### synchronized 锁的对象是谁？

- synchronized(lockObject)：锁指定对象的监视器。
- 实例 synchronized 方法：锁当前实例 this。
- static synchronized 方法：锁该类对应的 Class 对象。

两个不同业务实例的实例同步方法不天然互斥；static 也不会自动跨 JVM 共享同一监视器。

## 6. 同一段代码不等于同一把锁

下面的写法每次调用创建新锁，不能因此保护多个调用之间的同一份共享资源：

```java
void process() {
    ReentrantLock lock = new ReentrantLock();
    lock.lock();
    try {
        updateSharedResource();
    } finally {
        lock.unlock();
    }
}
```

这是示意代码，updateSharedResource 为教学方法。每次调用拿到不同锁对象，彼此没有共同的互斥点。

更常见的做法是在共享对象字段中持有同一个锁，或通过按 key 的缓存复用锁。具体要保证复用范围与资源范围一致。

**变量都叫 lock、执行代码都相同，并不能产生共享锁。** 对本地锁，首先确认是不是同一个锁实例。

## 7. 取得、持有、释放要分开

| 阶段 | 问题 |
| --- | --- |
| 获取 | 谁取得了锁？没拿到时等待还是返回？ |
| 持有 | 哪些操作在保护范围内？是否会抛异常、跨线程或返回异步任务？ |
| 释放 | 由谁释放？何时释放？是否已经成功取得？ |

### 常见获取 API

- lock()：等待取得锁；不能把它当成可中断等待的替代。
- tryLock()：立即尝试，成功或失败返回，不排队等待结果。
- tryLock(timeout, unit)：最多等待给定时间，可能因中断而退出。
- lockInterruptibly()：允许在等待获取时响应中断。

中断是线程的协作信号，不是强制终止所有业务。捕获 InterruptedException 后，必须理解自己的传播或恢复策略，不能仅因 catch 了就说“已停止”。

### tryLock 的释放前提

```java
boolean acquired = lock.tryLock();
if (!acquired) {
    return;
}
try {
    doWork();
} finally {
    lock.unlock();
}
```

只在成功取得后释放。与 Semaphore 不同，ReentrantLock 有线程所有权，不持有该锁的线程调用 unlock 会出错。

参考：[Java 17 ReentrantLock 官方 API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)。

## 8. 可重入：同一线程可以再次取得同一把锁

假设 A 方法取得锁后调用 B，B 也需要同一把锁。可重入允许当前持有线程再次获取，而不是被自己的锁挡住。

```text
线程 A 第一次 lock → 持有次数 1
线程 A 第二次 lock → 持有次数 2
线程 A 一次 unlock → 持有次数 1，仍未彻底释放
线程 A 再次 unlock → 持有次数 0
```

它不表示其他线程也能进入。成功重入几次就需要对应释放几次，外层那次持有也不能漏掉。

不要在读写锁上随意套用“可重入，所以任何升级转换都安全”的推论，具体转换要看对应实现与 API。

## 9. 公平与读写锁：先认识边界

### 公平锁

可以先理解为竞争时更倾向按等待顺序安排获取，代价和实际表现需要具体评估。公平不意味着线程调度严格均匀，也不等于吞吐一定更好。

对于 Java ReentrantLock，**无参 tryLock() 不遵守公平排队策略**。因此看到 new ReentrantLock(true)，再看到无参 tryLock，不能断言所有调用严格 FIFO。

这个区别在项目的 LocalLockCache 与防重复切面中会再次遇到。

### 读写锁

对同一把关联读写锁，不同线程的基本关系可以先看成：

| 线程 A 持有 | 线程 B 想获取 | 基本关系 |
| --- | --- | --- |
| 读锁 | 读锁 | 通常可以共享，仍需考虑实现的等待策略 |
| 读锁 | 写锁 | 冲突 |
| 写锁 | 读锁 | 冲突 |
| 写锁 | 写锁 | 冲突 |

读锁保护只读操作，不是拿了读锁就可以同时修改共享状态。读写锁也不保证在任何负载下都比普通互斥锁快。

参考：[Java 17 ReadWriteLock 官方 API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/ReadWriteLock.html)。

## 10. 两个 JVM 为什么不能只靠各自的本地锁？

```text
订单实例 A（JVM A）           订单实例 B（JVM B）
    本地锁 A                       本地锁 B
        ↓                              ↓
              同一数据库订单
```

锁 A 与锁 B 是不同进程中的对象。两个实例都可能成功拿到自己的锁，再同时操作同一订单。

把变量改成 static 不会把两个 JVM 的对象合成一个共享锁。只部署一台机器也不代表只有一个进程。

引入分布式锁，是让需要协作的进程通过约定的共享后端与标识参与协调。本项目使用 Redisson 与 Redis。

```text
JVM A ── 请求订单 1001 对应的锁 ──┐
                                  Redis 中约定的锁状态
JVM B ── 请求订单 1001 对应的锁 ──┘
```

这只是概念图。Redis 实际存储、Lua、所有者、续期和通知放在后续课程，不把它简化为“一次随意 SET 就是完整安全分布式锁”。

## 11. 分布式锁的关键：共同后端、兼容规则与业务 key

对需要互斥的业务，至少检查：

1. 参与者是否连接到同一协调后端与适当命名空间。
2. 是否按同一约定生成资源对应的锁名。
3. 锁类型与读写关系是否匹配。
4. 所有相关路径是否实际获取并遵守这套锁。

例如约定订单锁名：

```text
order:1001
```

不同订单可以使用不同 key。全用 order:all 可能让无关订单串行；同一订单分别用 order:1001 与 order:1001:other，则未必在同一协调点竞争。

分布式锁具有协作性质，不会阻止完全绕开它的数据库写入，也不是数据库唯一约束、条件更新或事务的自动替代。

Redisson 的具体能力可参考 [官方锁与同步器说明](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/)。官网内容随版本变化，后续以本项目实际解析版本选读实现。

## 12. 连接到项目源码：本课只认识三个入口

### 12.1 LocalLockCache：本机按 key 复用锁

文件位于 `damai-redisson-common-framework/src/main/java/com/damai/locallock/LocalLockCache.java`，该模块在 `damai-redisson-framework/damai-redisson-service-framework` 下。

核心代码：

```java
return localLockCache.get(lockKey, key -> new ReentrantLock(fair));
```

在缓存当前条目有效时，相同 key 复用已有 ReentrantLock，避免每次调用都创建互不协调的锁。缓存本身在当前 JVM 中，不会自动跨进程共享。

它配置了 expireAfterWrite；所以不能把“相同 key 复用”说成永久返回同一对象，缓存淘汰与正在使用锁的关系以后再分析。fair 参数主要在创建时使用，缓存命中不会因为后一次参数不同就自动更换已有锁。

### 12.2 RedissonReentrantLocker：通过客户端取得远程锁对象

文件位于 service-lock 模块的 `servicelock/impl/RedissonReentrantLocker.java`。

```java
RLock lock = redissonClient.getLock(lockKey);
lock.lock();
return lock;
```

分开看：getLock 取得分布式锁对象引用；lock() 才执行获取操作。项目也有仅返回 getLock 结果的接口，不能把它认定为已经持锁。

tryLock 封装还支持等待参数；与 JDK 本地锁的形式相似，但实际状态协调发生在不同层，网络和 Redis 故障也可能影响结果。

### 12.3 RedissonReadLocker：关联读写锁的读侧

```java
redissonClient.getReadWriteLock(lockKey).readLock();
```

这说明不是所有实现都用 getLock。读锁和写锁需要属于同一资源对应的读写锁机制，不能只看到相同 key 就忽略锁类型。

本课不要求精读所有重载；先指出每个对象来自本地还是远程、哪个调用才获取、谁负责释放即可。

## 13. 独立实验：五组行为，不依赖 Redis

保存为 `SharedResourceLockDemo.java`，使用 JDK 17 或更高版本运行：`java SharedResourceLockDemo.java`。

A 使用 CyclicBarrier，让两个线程都完成读取后才继续写，明确构造一种可能的竞态交错。它只是实验协调工具，不是正确扣库存方法的一部分。B 则在同一锁保护下完成整个检查与更新。

C 只在一个 JVM 中比较同一锁对象与不同锁对象，用于理解互斥范围；不把这个实验称作真实的双进程或 Redis 分布式锁验证。

```java
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

public class SharedResourceLockDemo {
    static void runTwo(Runnable task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = pool.submit(task);
            Future<?> second = pool.submit(task);
            first.get(3, TimeUnit.SECONDS);
            second.get(3, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    static boolean tryOnce(ReentrantLock lock) {
        boolean acquired = lock.tryLock();
        if (!acquired) {
            return false;
        }
        try {
            return true;
        } finally {
            lock.unlock();
        }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("-- A: 复合操作仍有竞态 --");
        AtomicInteger stockA = new AtomicInteger(1);
        AtomicInteger soldA = new AtomicInteger();
        CyclicBarrier bothRead = new CyclicBarrier(2);
        runTwo(() -> {
            int before = stockA.get();
            try {
                bothRead.await(3, TimeUnit.SECONDS);
            } catch (Exception error) {
                throw new IllegalStateException(error);
            }
            if (before > 0) {
                stockA.set(before - 1);
                soldA.incrementAndGet();
            }
        });
        System.out.println("库存=" + stockA.get() + ",售出=" + soldA.get());

        System.out.println("-- B: 同一把锁保护检查与更新 --");
        AtomicInteger stockB = new AtomicInteger(1);
        AtomicInteger soldB = new AtomicInteger();
        ReentrantLock shared = new ReentrantLock();
        runTwo(() -> {
            shared.lock();
            try {
                int before = stockB.get();
                if (before > 0) {
                    stockB.set(before - 1);
                    soldB.incrementAndGet();
                }
            } finally {
                shared.unlock();
            }
        });
        System.out.println("库存=" + stockB.get() + ",售出=" + soldB.get());

        System.out.println("-- C: 同一个对象与不同对象 --");
        ReentrantLock held = new ReentrantLock();
        ReentrantLock different = new ReentrantLock();
        ExecutorService worker = Executors.newSingleThreadExecutor();
        held.lock();
        try {
            boolean sameResult = worker.submit(() -> tryOnce(held)).get(3, TimeUnit.SECONDS);
            boolean otherResult = worker.submit(() -> tryOnce(different)).get(3, TimeUnit.SECONDS);
            System.out.println("其他线程取得同一锁=" + sameResult);
            System.out.println("其他线程取得另一锁=" + otherResult);
        } finally {
            held.unlock();
            worker.shutdownNow();
        }

        System.out.println("-- D: 同线程重入与对应释放 --");
        ReentrantLock reentrant = new ReentrantLock();
        reentrant.lock();
        try {
            System.out.println("外层持有次数=" + reentrant.getHoldCount());
            reentrant.lock();
            try {
                System.out.println("重入后持有次数=" + reentrant.getHoldCount());
            } finally {
                reentrant.unlock();
            }
            System.out.println("退出内层持有次数=" + reentrant.getHoldCount());
        } finally {
            reentrant.unlock();
        }
        System.out.println("最终仍被持有=" + reentrant.isLocked());

        System.out.println("-- E: 业务异常后仍释放 --");
        ReentrantLock failed = new ReentrantLock();
        try {
            failed.lock();
            try {
                throw new IllegalStateException("模拟业务异常");
            } finally {
                failed.unlock();
            }
        } catch (IllegalStateException error) {
            System.out.println("捕获=" + error.getMessage());
        }
        System.out.println("异常后仍被持有=" + failed.isLocked());
    }
}
```

预期输出：

```text
-- A: 复合操作仍有竞态 --
库存=0,售出=2
-- B: 同一把锁保护检查与更新 --
库存=0,售出=1
-- C: 同一个对象与不同对象 --
其他线程取得同一锁=false
其他线程取得另一锁=true
-- D: 同线程重入与对应释放 --
外层持有次数=1
重入后持有次数=2
退出内层持有次数=1
最终仍被持有=false
-- E: 业务异常后仍释放 --
捕获=模拟业务异常
异常后仍被持有=false
```

不要把 A 的 barrier 直接放到 B 的临界区：第一个线程持锁等待第二个线程，而第二个线程又需要先取得同一锁才能到达 barrier，就会发生等待冲突。实验同步工具的位置也需要分析。

get 的超时只为避免实验无限等待，不是对生产并发性能的测量。Future.get 在这个独立 main 中等待结果，不表示它本身非阻塞。

验证记录：本地 JDK 25 使用 `--source 17` 运行，五组实际输出均与上述预期一致。没有连接 Redis，也未验证真实 Redisson 的远程锁、租期与故障语义。

## 14. 三个容易过度推断的结论

### 加了锁，不代表业务幂等

第一次处理结束并释放后，第二次顺序调用仍可能再次取得锁。是否已执行过，需要业务状态、标记、唯一约束等另行判断，第 06 课展开。

### finally 释放，不代表异步工作已完成

若临界区只创建一个 Future 或 Mono 就返回，finally 可能在真正工作结束前执行。本课实验都是同步工作，不包含这一额外生命周期。

### 本地实验通过，不代表分布式场景已验证

真实 Redisson 还涉及网络、远程状态、租期和所有者。没有连接 Redis 的五组实验只验证本地并发与 Java 控制流程。

## 15. 练习

1. 库存最终为 0，是否能证明没有超卖？
2. AtomicInteger.get 和 set 各自安全，为什么组合后仍可能出错？
3. 只给库存 set 加锁，读和判断留在外面是否足够？
4. 每次调用都 new ReentrantLock，能保护调用之间共享的同一订单吗？
5. 两个不同实例的 synchronized 方法一定互斥吗？
6. static synchronized 能直接协调两个 JVM 吗？
7. 本地 tryLock 返回 false 后，是否应在 finally 无条件 unlock？
8. 同一线程重入两次，只 unlock 一次是否完全释放？
9. new ReentrantLock(true) 后，无参 tryLock 是否严格按排队顺序？
10. 多个线程都拿读锁，能否因此同时修改同一数据？
11. 两个服务处理同一订单，各自拿到自己的本地锁，是否证明业务互斥？
12. 同一订单使用不同分布式锁名，是否必然互斥？
13. redissonClient.getLock 返回后，是否已经取得锁？
14. LocalLockCache 同 key 是否永远返回同一实例？
15. 本课实验 C 是否证明了 Redis 的跨进程锁行为？
16. 取得并释放锁后再次顺序调用，是否会自动被拒绝？

## 16. 参考答案

### 1. 库存不负数是否足够

不够。两个线程都根据旧值 1 写回 0，也可能各自确认一次售出。要检查业务不变量与实际售出次数，不能只看最终字段。

### 2. 单个原子操作与复合操作

原子性没有自动覆盖多个方法之间的判断与关系。需要保护整个复合逻辑，或选择合适的条件更新等方案。

### 3. 仅锁 set

通常不足以保证本例正确。两个线程可能在锁外都判定有库存，再串行写入基于旧读取值的结果；应把相关检查与更新纳入同一保护范围。

### 4. 每次创建新锁

不能仅靠这种方式协调多个调用。不同锁对象没有共同互斥点，必须复用与资源对应的锁并覆盖正确范围。

### 5. 不同实例的同步方法

不一定互斥。实例同步方法锁各自的 this，两个对象的监视器不同。还要看共享资源实际由谁访问。

### 6. static 是否跨 JVM

不能。每个 JVM 有自己的类与运行时状态，static 不把监视器变成跨进程协调服务。

### 7. 未取得能否释放

不应该。只有成功取得才进入对应释放路径；不持有锁的线程调用 ReentrantLock.unlock 会失败，可能掩盖原来的业务结果。

### 8. 重入的释放次数

没有完全释放，还剩一次持有。成功重入与释放需要配对，直到持有次数归零。

### 9. 公平与无参 tryLock

无参 tryLock 不遵守 ReentrantLock 的公平排队策略，不能只看构造参数就断定每次严格 FIFO。

### 10. 读锁下修改

不可以由读共享语义推导出写安全。读锁允许多读者共享，修改应遵循对应写入协调规则；所有相关路径也需要配合。

### 11. 各自本地锁是否互斥

不能证明。它们只协调各自进程中的调用，可能同时影响同一数据库订单，需要远程协调、数据库约束等适当方案。

### 12. 不同锁名

不保证互斥。对于相同业务资源，应使用一致、兼容的锁标识和后端规则，不能各自生成不同协调点。

### 13. getLock 是否持锁

不是。它取得锁对象引用，真正获取由 lock / tryLock 等操作完成。需要检查调用结果和失败路径。

### 14. 缓存锁是否永久同一对象

不是。条目有效时会复用，但过期或失效后可能重新创建。当前缓存生命周期与持锁生命周期的关系将在源码课分析。

### 15. 实验 C 的范围

没有验证 Redis。它在同一 JVM 中比较对象身份与互斥行为，只用于建立进程范围的直觉。

### 16. 顺序重复是否自动拒绝

不会仅因曾经加过锁就拒绝。锁释放后可以再次获取，防重复与业务幂等需要进一步设计。

## 17. 本课通关与下一课

不看答案，尝试解释：锁保护的是资源的一组操作；相关竞争者必须遵守同一个协调点；同一 JVM 的对象锁与多进程的远程锁范围不同；获取、业务完成和释放必须分别确认。

下一课补 Redis 必要基础：String、Hash、TTL、原子命令、Lua 与发布订阅，让你知道 Redisson 的锁、标记和队列状态存放在哪里，以及 Redis 原子操作不等于什么。

继续阅读：[第 02 课：Redis 必要基础（含答案）](damai-redisson-framework-第02课-Redis必要基础（含答案）.md)。
