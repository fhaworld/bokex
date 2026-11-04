---
title: "redisson应用-第03课-锁API与生命周期（含答案）"
description: "redisson应用系列第03课，主题：锁API与生命周期（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 03 课：Redisson 锁 API 与生命周期（含答案）

## 1. 本课目标

前两课已理解共享资源、Redis 状态与过期。现在学习项目真正调用的 Redisson 锁接口，重点回答：

1. 取得 RLock 对象与取得锁有什么区别？
2. waitTime、leaseTime、watchdog timeout 分别管哪段时间？
3. 哪个调用触发续期，谁有权解锁？
4. 项目 ServiceLocker 的参数怎样转交到底层 API？

本课先学接口与时间线，完整 AOP 与业务锁名在后续课程展开。

总入口：[课程学习导航](damai-redisson-framework-课程学习导航.md)。

## 2. 版本依据与验证范围

根 pom 声明 Redisson 3.32.0。本地也有对应 redisson-3.32.0.jar，本课用 javap 查看了 RLock 接口、RedissonLock 的租期分支与 Config 的默认字段赋值。

能确认：RLock 提供带 waitTime / leaseTime 的重载；RedissonLock 在成功获取后按正租期或续期分支处理；Config 默认 lockWatchdogTimeout=30000 毫秒。

这是对指定 JAR 的接口和字节码核对，不代表已经解析当前完整 Maven 依赖树，也不是运行 Redis 集成测试。

概念可参考 [Redisson 官方锁说明](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/#lock)。官网当前内容可能包含更新版本的功能，本课只选本项目调用到的基础 API。

## 3. getLock：取得引用，不是申请所有权

```java
RLock lock = redissonClient.getLock("order:1001");
```

这里得到一个可以操作对应分布式锁的对象，不能因此宣称业务已经互斥。

接着执行 lock() 或 tryLock(...)，才进入实际获取过程。

```text
准备操作哪把锁 → 发起获取 → 成功持有 → 执行业务 → 释放
```

本地 ReentrantLock 强调共享同一个锁实例；Redisson 的多个 Java 锁对象可以通过同一后端、锁名和兼容协议协调同一份远程状态。不能把“Java 对象引用不同”直接推成“分布式锁一定不同”。

反过来，只有名字相同也不够：不同后端、数据库或不兼容的锁机制仍可能无法形成预期互斥。

## 4. 三个时间参数先分清

| 参数 | 观察的阶段 | 核心问题 |
| --- | --- | --- |
| waitTime | 获取锁之前的竞争等待 | 愿意等多久取得锁？ |
| leaseTime | 获取成功后的租期 | 没提前释放时，这次锁状态按多长租期存活？ |
| lockWatchdogTimeout | 续期模式使用的超时窗口 | 没能继续续期时，已有锁状态多久后可能到期？ |

一个示例：

```java
boolean acquired = lock.tryLock(3, 8, TimeUnit.SECONDS);
```

意思是最多按给定等待预算竞争约 3 秒；如果获取成功，使用 8 秒租期。不是先无条件睡 3 秒，再执行业务 8 秒。

有空闲锁时可以很快成功；租期也不是业务最大执行时长。实际方法延迟还受网络、重试、服务端与调度影响，不能把 waitTime 当成任何故障下整段调用的精确墙钟上限。

## 5. 常用 API 对照

以下以普通 RLock 与正常正数时间为讨论前提，特殊参数不要凭直觉推断。

| API | 获取行为 | 获取成功后的租期方向 |
| --- | --- | --- |
| getLock(name) | 只取得对象引用 | 尚未获取 |
| lock() | 等待获取，不用业务 waitTime 参数限制 | 未显式指定租期，涉及 watchdog 续期机制 |
| lock(8, SECONDS) | 等待获取 | 明确正租期 8 秒 |
| tryLock() | 不设置排队等待时长，立即尝试获取 | 未显式指定正租期，涉及续期机制 |
| tryLock(3, SECONDS) | 按等待预算尝试 | 未显式指定租期，涉及续期机制 |
| tryLock(3, 8, SECONDS) | 按等待预算尝试 | 明确正租期 8 秒 |
| unlock() | 释放当前所有者的一次持有 | 最后一次释放后结束相应持有 |

远程 tryLock() 的“立即尝试”不表示完全没有网络等待或不可能抛异常。它与普通本地 tryLock 的成本和失败来源不同。

lock() 也不是可中断获取接口的同义词；需要可中断等待时应查 lockInterruptibly 等 API。项目 ServiceLocker 并没有把全部底层能力都暴露出来。

## 6. 显式租期：到期与业务结束是两条线

假设取得锁后租期为 5 秒，但业务持续 8 秒：

```text
0s  A 取得锁，租期 5 秒，开始业务
5s  远程锁状态到期，A 的业务未必停止
6s  B 可能取得同名锁，开始自己的业务
8s  A 完成业务并尝试 unlock
```

A 可能已不是当前所有者，unlock 可能抛 IllegalMonitorStateException；更重要的是，5～8 秒之间旧业务可能仍在执行。

把租期随意缩短，不能保证业务更安全。租期必须结合处理时间、故障与资源保护要求设计；本课不把设置固定 5 秒作为通用建议。

显式正租期的普通路径不会因为客户端还在运行就自动得到与未指定租期一样的 watchdog 续期。具体分支要看实际版本与调用，不能把所有 lock 方法都当作同一种模式。

## 7. watchdog：维护锁状态，不是业务监控器

未显式指定租期的常用获取路径，在成功获取后会安排续期。可以先理解为：客户端在满足条件时周期性延长自己持有的锁状态，避免正常长业务因为一次固定短租期而提前失去锁。

Redisson 3.32.0 的默认 watchdog timeout 为 30 秒。**这不是说业务超过 30 秒必定释放，也不是默认只能执行 30 秒。**

```text
取得锁 → 当前有超时窗口
    → 续期成功，窗口向后延长
    → 再次续期成功，继续延长
    → 解锁，结束持有并停止相应续期
```

若客户端停止、续期无法及时执行或 Redis 不可达，状态可能在最后一次有效续期之后到期。也不能承诺“进程还活着就永远不会失锁”，长时间暂停等仍需纳入故障分析。

watchdog 不会判断业务订单是否真的提交成功，不会替你解业务死锁，也不把数据库事务和 Redis 状态变成同一个事务。

本课不要求背“每隔几秒续期一次”；调度实现、批处理和具体调用链留到对应版本底层选读。

## 8. 所有者：不是知道 key 就能解锁

普通同步 RLock 的持有语义与客户端及线程身份关联。业务锁名相同，不代表任意线程都有权释放。

```text
客户端 A 的线程 1 获取
    ├── 线程 1 按规则释放：正常路径
    ├── 线程 2 直接 unlock：不能当作同一所有者
    └── 客户端 B 的线程 1：也不是 A 的线程 1
```

所以把工作提交到线程池后，在另一个线程上直接释放普通同步锁，需要重新分析线程所有权，不能仅凭“还在同一台机器上”认定安全。

异步、响应式 API 有自己的线程 ID 与生命周期用法，本课不把同步接口简单搬过去；项目当前 ServiceLocker 主线使用同步调用。

### 三个观察方法

| 方法 | 含义 | 不能代替什么 |
| --- | --- | --- |
| isLocked() | 当前是否有持有状态 | 不是“我已取得锁” |
| isHeldByCurrentThread() | 查询当前线程是否持有 | 不是把查询与后续操作变为原子整体 |
| getHoldCount() | 当前线程的重入持有次数 | 不是业务调用次数统计 |

查询与实际释放之间状态仍可能变化。判断一次 held=true 不保证未来任何时刻 unlock 都成功，也不能用 isLocked=true 就直接代替正确获取。

## 9. 可重入与释放次数

同一所有者可以再次获取对应可重入锁。通常需要相应次数的 unlock，直到持有计数归零才真正释放。

```text
A 第一次取得 → 计数 1
A 再次取得   → 计数 2
A unlock     → 计数 1，B 仍不能据此进入
A unlock     → 计数 0，结束持有
```

本课不混用同一 key 上的固定租期与续期模式做实验。重入时如果不同调用指定不同租期，必须按真实实现分析状态变化，不能把每层方法的租期都想成完全独立计时器。

## 10. 项目 ServiceLocker 与底层参数顺序

接口路径：`damai-redisson-framework/damai-redisson-service-framework/damai-service-lock-framework/src/main/java/com/damai/servicelock/ServiceLocker.java`。

以 RedissonReentrantLocker 为例：

| 项目封装调用 | 内部 Redisson 调用 | 你应读出的语义 |
| --- | --- | --- |
| getLock(key) | redissonClient.getLock(key) | 未执行获取 |
| lock(key) | lock.lock() | 不显式指定租期 |
| lock(key, leaseTime) | lock.lock(leaseTime, SECONDS) | 默认租期单位是秒 |
| lock(key, unit, leaseTime) | lock.lock(leaseTime, unit) | 传入指定租期单位 |
| tryLock(key, unit, waitTime) | lock.tryLock(waitTime, unit) | 只指定等待，不指定正租期 |
| tryLock(key, unit, waitTime, leaseTime) | lock.tryLock(waitTime, leaseTime, unit) | 同时指定等待与租期 |
| unlock(key) | getLock(key) 后 unlock() | 重新取得引用再按所有者规则释放 |
| unlock(lock) | lock.unlock() | 对传入对象执行释放 |

参数单位在项目接口中排得更靠前，转交到底层时又移到最后。只看一串 long，很容易把两个时间读反。

### 四类实现选择不同对象

- RedissonReentrantLocker：getLock(key)。
- RedissonFairLocker：getFairLock(key)。
- RedissonReadLocker：getReadWriteLock(key).readLock()。
- RedissonWriteLocker：getReadWriteLock(key).writeLock()。

读写语义需要一套关联机制，不能把同名普通锁、读锁与公平锁当作可随意混用的统一协议。

## 11. 项目的 false 与异常不要合并

当前 tryLock 封装：

```java
try {
    return lock.tryLock(waitTime, unit);
} catch (InterruptedException e) {
    return false;
}
```

因此上层收到 false 可能是未取得锁，也可能是等待被中断后被包装为 false。当前 catch 没有恢复中断标记，也没把中断原因向上暴露。

但并非所有失败都变成 false：getLock 调用位于这个 try 之前，其他 Redis 运行时异常也未由这个 InterruptedException catch 统一处理。

这与下一阶段超时策略有关：上层切面可能把不同失败原因都按“未取得”处理，需要沿实际分支核对。

## 12. 注解默认 10 秒，究竟管什么？

ServiceLock 当前提供：

```java
long waitTime() default 10;
TimeUnit timeUnit() default TimeUnit.SECONDS;
```

切面使用不带 leaseTime 的项目重载。因此默认是等待获取的配置，不是给业务指定 10 秒固定租期。

注解中没有显式 leaseTime 属性，不表示底层从不使用超时状态；未显式指定租期的获取路径仍依赖对应版本的续期与过期机制。

实际业务等待多久、是否发生续期，还需结合装配、锁类型、调用版本与运行环境验证。

## 13. finally 的正确使用与边界

教学模板：

```java
boolean acquired = lock.tryLock(3, 8, TimeUnit.SECONDS);
if (!acquired) {
    return;
}
try {
    doSynchronousWork();
} finally {
    lock.unlock();
}
```

这是基于方法签名的示意片段，需要处理相应受检异常，并满足同步工作、所有者与租期等前提。

三个边界：

1. 获取失败不能无条件 unlock。
2. 租期已过或所有者不匹配时，finally 中 unlock 仍可能抛异常；finally 不保证释放操作永远成功。
3. try 中返回 Future / Mono，finally 会在方法返回前运行，不自动等异步工作结束。

如果业务本来抛了异常，解锁又抛另一个异常，还需要分析最终向外传播的异常是否掩盖了业务原因。后续故障路径课会专门推演。

## 14. 独立实验：五组生命周期模型

本课不连接 Redis，不执行真实续期任务。下面是单线程、手动推进时间的模型，用来验证时间线与 Java 方法边界。

模型只表示一个可重入独占锁，不模拟公平锁、读写锁、排队等待、网络或实际 owner 编码。owner 字符串如 A:1 只是“客户端 A 的线程 1”的教学标识。

续期由主程序主动调用 renewIfAlive，不是实际 watchdog 调度器；它用于说明续期怎样延后到期，以及停止续期后的状态。

保存为 `RedissonLockLifecycleDemo.java`，用 JDK 17 或更高版本作为普通 main 运行。

```java
import java.util.concurrent.CompletableFuture;

public class RedissonLockLifecycleDemo {
    static class LockState {
        long now;
        String owner;
        int holds;
        long expiresAt;
        long leaseMillis;
        boolean renewable;

        void expireIfNeeded() {
            if (owner != null && now >= expiresAt) {
                owner = null;
                holds = 0;
                renewable = false;
            }
        }

        boolean acquire(String candidate, long ttlMillis, boolean autoRenew) {
            expireIfNeeded();
            if (owner != null && !owner.equals(candidate)) {
                return false;
            }
            owner = candidate;
            holds++;
            leaseMillis = ttlMillis;
            expiresAt = now + ttlMillis;
            renewable = autoRenew;
            return true;
        }

        void renewIfAlive(String candidate) {
            expireIfNeeded();
            if (renewable && candidate.equals(owner)) {
                expiresAt = now + leaseMillis;
            }
        }

        void unlock(String candidate) {
            expireIfNeeded();
            if (!candidate.equals(owner)) {
                throw new IllegalMonitorStateException("不是当前持有者");
            }
            holds--;
            if (holds == 0) {
                owner = null;
                renewable = false;
            }
        }

        String currentOwner() {
            expireIfNeeded();
            return owner;
        }

        void advance(long millis) {
            now += millis;
        }
    }

    static CompletableFuture<String> returnBeforeWork(LockState state) {
        if (!state.acquire("A:1", 30000, true)) {
            throw new IllegalStateException("未取得锁");
        }
        try {
            return new CompletableFuture<>();
        } finally {
            state.unlock("A:1");
        }
    }

    public static void main(String[] args) {
        System.out.println("-- A: 固定租期先于业务结束 --");
        LockState fixed = new LockState();
        System.out.println("A取得=" + fixed.acquire("A:1", 5000, false));
        fixed.advance(6000);
        System.out.println("B取得=" + fixed.acquire("B:1", 5000, false));
        try {
            fixed.unlock("A:1");
        } catch (IllegalMonitorStateException error) {
            System.out.println("旧A解锁=" + error.getMessage());
        }
        System.out.println("当前持有者=" + fixed.currentOwner());

        System.out.println("-- B: 续期延后到期 --");
        LockState watched = new LockState();
        watched.acquire("A:1", 30000, true);
        watched.advance(10000);
        watched.renewIfAlive("A:1");
        watched.advance(25000);
        System.out.println("35秒时持有者=" + watched.currentOwner());
        watched.advance(6000);
        System.out.println("未再续期41秒时=" + watched.currentOwner());

        System.out.println("-- C: 重入与对应释放 --");
        LockState reentrant = new LockState();
        reentrant.acquire("A:1", 5000, false);
        reentrant.acquire("A:1", 5000, false);
        System.out.println("重入计数=" + reentrant.holds);
        reentrant.unlock("A:1");
        System.out.println("释放一次计数=" + reentrant.holds);
        reentrant.unlock("A:1");
        System.out.println("释放两次持有者=" + reentrant.currentOwner());

        System.out.println("-- D: 其他线程身份不能释放 --");
        LockState threadOwner = new LockState();
        threadOwner.acquire("A:1", 5000, false);
        try {
            threadOwner.unlock("A:2");
        } catch (IllegalMonitorStateException error) {
            System.out.println("线程2解锁=" + error.getMessage());
        }
        System.out.println("原持有者=" + threadOwner.currentOwner());

        System.out.println("-- E: 返回Future前finally已运行 --");
        LockState async = new LockState();
        CompletableFuture<String> future = returnBeforeWork(async);
        System.out.println("方法返回时任务已完成=" + future.isDone());
        System.out.println("方法返回时持有者=" + async.currentOwner());
        future.complete("done");
        System.out.println("稍后任务结果=" + future.join());
    }
}
```

预期输出：

```text
-- A: 固定租期先于业务结束 --
A取得=true
B取得=true
旧A解锁=不是当前持有者
当前持有者=B:1
-- B: 续期延后到期 --
35秒时持有者=A:1
未再续期41秒时=null
-- C: 重入与对应释放 --
重入计数=2
释放一次计数=1
释放两次持有者=null
-- D: 其他线程身份不能释放 --
线程2解锁=不是当前持有者
原持有者=A:1
-- E: 返回Future前finally已运行 --
方法返回时任务已完成=false
方法返回时持有者=null
稍后任务结果=done
```

E 只创建并稍后完成一个 Future，没有启动后台工作线程。它证明当前方法 finally 与 Future 完成可以分离，不是对项目异步业务的集成验证。

验证记录：本地 JDK 25 使用 `--source 17` 运行，五组模型输出均与讲义一致。没有连接 Redis，也未运行真实续期、租期到期或跨线程解锁实验。

## 15. 有真实 Redis 后应怎样验证？

将来使用隔离的测试 key 与实际依赖版本，分别观察：

1. 两个客户端竞争同一普通锁与不同锁。
2. waitTime 为 0、正值时的获取结果和错误。
3. 固定正租期到期后的其他持有者获取与旧持有者解锁。
4. 不显式指定租期时，remainTimeToLive 随续期变化。
5. 同一所有者重入计数与释放，另一个线程错误释放。
6. 停止客户端或制造续期不可达时，状态与业务的分离。

必须标明是同 JVM 两线程、两个 RedissonClient，还是两个独立进程；不能用线程名差异替代所有者与后端验证。

本课没有进行这些远程实验，不能把模型中的精确毫秒时刻直接当作真实续期调度结果。

## 16. 练习

1. getLock 得到 RLock 后，能直接认为库存操作已受保护吗？
2. 两个 Java RLock 引用不同，是否必然不是同一远程锁？
3. tryLock(3, 8, SECONDS) 的两个数字分别表示什么？
4. waitTime=3 是否代表每次都先等待 3 秒？
5. leaseTime=5 是否会在 5 秒时强制停止业务线程？
6. 默认 watchdog timeout=30 秒，业务到 31 秒是否必定失锁？
7. 显式正租期是否因客户端活着而必然获得自动续期？
8. 客户端仍活着，是否能保证续期永远不会失败？
9. 同一客户端的另一个线程能直接 unlock 普通同步锁吗？
10. isLocked=true 是否说明当前线程拥有锁？
11. isHeldByCurrentThread=true 是否保证稍后 unlock 永远不会失败？
12. 重入两次、释放一次后，其他所有者是否就能获取？
13. 项目 tryLock(key, unit, wait, lease) 怎样传到底层？
14. 项目默认 @ServiceLock 的 10 秒是租期吗？
15. 当前封装返回 false，是否一定只代表普通等待超时？
16. Redis 运行时异常是否全部被当前 catch 转为 false？
17. finally unlock 是否能保证不掩盖业务异常？
18. 本课模型是否证明了真实 Redisson 的 watchdog 调度与网络行为？

## 17. 参考答案

### 1. 对象与获取

不能。getLock 只取得引用，必须执行获取并确认成功，才能按协议进入受保护范围。

### 2. 引用与远程状态

不必然不同。不同 Java 对象可以通过同一后端、相同锁名和兼容机制访问共同状态，要检查连接与协议范围。

### 3. 等待与租期

3 是获取锁的等待预算，8 是成功获取后的正租期，单位都是秒。二者不是业务的两段固定运行时间。

### 4. 是否固定等待

不是，空闲时可能很快成功。真实调用也包含网络等成本，等待参数不是任何故障下的精确总耗时保证。

### 5. 到期与停止线程

不会强制停止业务。锁状态可能到期，旧业务仍在运行，因此新持有者与旧业务的交错需要额外分析。

### 6. 超过默认窗口

不一定失锁。未显式租期的相应路径会安排续期，续期成功则延长窗口；30 秒不是业务最大执行时长。

### 7. 正租期与续期

不能这样推断。普通显式正租期路径与未显式指定租期的续期路径不同，应按对应版本和实际 API 判断。

### 8. 存活是否保证续期

不保证，调度暂停、连接与服务端故障等仍可能影响续期。watchdog 不等于绝对不会提前失锁。

### 9. 跨线程释放

普通同步接口不能仅凭同客户端就认为同所有者。所有者涉及线程身份，另一个线程直接 unlock 可能抛 IllegalMonitorStateException。

### 10. isLocked 的含义

只表明存在持有状态，不证明属于当前线程。获取结果和所有者应分别确认。

### 11. 查询后的状态变化

不保证，查询与后续操作之间仍可能到期或发生其他变化。查询不是把后面的动作一起锁定。

### 12. 重入释放

通常不能，尚余一次持有。需要释放计数归零，或者按实际故障与到期机制结束状态。

### 13. 参数转发

项目接口单位在前，底层调用为 lock.tryLock(waitTime, leaseTime, unit)。读取重载时要逐项对应。

### 14. 注解默认时间

是等待获取时间，不是固定租期。当前注解与切面没有通过该字段显式指定 leaseTime。

### 15. false 的来源

不一定只是超时。当前封装还把 InterruptedException 转成 false，丢失了与普通未取得之间的区分。

### 16. 其他异常

没有全部捕获。这里只 catch InterruptedException，其他运行时错误以及 try 外的调用还可能向外传播。

### 17. 解锁异常

不能保证。解锁也可能失败并抛异常，需要检查是否覆盖原业务异常；finally 保证执行到相应语句，不保证这条语句成功。

### 18. 验证边界

模型只验证手动时钟与 Java 控制流。对应 JAR 的接口、分支和默认值另经字节码核对，但没有连接 Redis 验证真实远程行为。

## 18. 本课通关与下一课

拿到任意一条项目 lock / tryLock 调用，能说出锁对象来源、等待时间、正租期是否显式指定、是否涉及续期、谁释放以及异常怎样退出，就达到本课目标。

下一课进入 Spring AOP、代理与事务切面，解释 @ServiceLock 怎样拦截方法，以及为什么“方法上写了注解”不等于任何调用方式都会受保护。

继续阅读：[第 04 课：Spring AOP、代理与事务切面（含答案）](damai-redisson-framework-第04课-AOP代理与事务切面（含答案）.md)。
