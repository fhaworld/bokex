---
title: "redisson应用-第02课-Redis必要基础（含答案）"
description: "redisson应用系列第02课，主题：Redis必要基础（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 02 课：Redis 必要基础（含答案）

## 1. 本课目标

上一课认识了本地锁与多进程协调。这一课学习 Redis 的必要概念，让你读到 RedissonClient、RBucket、锁状态与延迟队列时，知道它们背后可能涉及什么。

重点掌握：key 与数据类型、TTL、条件写入、原子命令与复合操作、Lua、发布订阅，以及网络失败的含义。

本课不要求学习 Redis 全部运维、持久化或集群实现，也不提前背 Redisson 全部内部键结构。

总入口：[课程学习导航](damai-redisson-framework-课程学习导航.md)。

## 2. Redis 与 Java Map 的联系和区别

可以先把 Redis 理解成可通过网络访问的数据结构服务。客户端按 key 操作值，但值不只是一段普通文本。

```text
Java 服务 A ──> Redis 中的共享状态 <── Java 服务 B
```

| 对比 | JVM 中的 Map | Redis |
| --- | --- | --- |
| 存放位置 | 当前进程内存 | Redis 服务端 |
| 调用方式 | 本地方法调用 | 客户端编码后发送网络命令 |
| 多进程共享 | 不会自动共享同一对象 | 可约定访问同一服务端数据 |
| 失败来源 | 本地状态、代码和资源 | 还包括连接、超时、认证和服务端状态 |
| 到期处理 | 取决于缓存实现 | 支持服务端 key 过期机制 |

因此 getBucket(key).get() 看起来像普通 getter，也不能当成无成本的字段读取。同步调用可能等待网络结果，客户端还要负责序列化与解码。

## 3. key 的名字不是装饰

例如：

```text
lesson:r2:order:1001
lesson:r2:repeat:request-001
```

它们是教学 key，不是本项目真实 key 格式。

key 是访问某份 Redis 状态的标识。相同名字只有在同一约定的后端、数据库和命名空间中，才可能指向同一份数据。

冒号和业务前缀常用于组织名称，但不是自动创建文件夹。业务隔离来自约定与实际连接配置，不是单凭名字看起来不同层级。

本项目 RedissonCommonAutoConfiguration 使用 useSingleServer，并设置地址、database 和 password。这里的数据库编号不是多租户授权机制，也不能照搬为 Redis Cluster 支持任意数据库的保证。

## 4. 先认识六种基础形态

| 类型或视角 | 可以先怎样理解 | 常见命令或操作 | 与本课程的联系 |
| --- | --- | --- | --- |
| String | 一段字节数据 | SET、GET、INCR | 成功标记、简单值与计数 |
| Hash | 一个 key 内多个 field-value | HSET、HGET、HINCRBY | 理解多字段状态、重入计数的基础 |
| List | 有序序列，可从两端操作 | LPUSH、RPUSH、LPOP、BLPOP | 理解队列与阻塞读取 |
| Set | 不重复成员集合 | SADD、SISMEMBER | 理解成员判断，不等于布隆过滤器 |
| ZSet | 成员带 score 的有序集合 | ZADD、ZRANGEBYSCORE | 理解按到期时间组织状态的思路 |
| 位操作 | 在字节串中操作 bit | SETBIT、GETBIT | 理解布隆过滤器的位数组 |

这是概念对应，不是宣称每个 Redisson 对象在当前版本中只用某一种结构。锁、延迟队列和布隆对象可能由多个 key、脚本和辅助状态共同实现，后面按对应版本核查。

Redis String 是字节序列，Java String 是字符对象。客户端 codec 决定如何编码。直接用 redis-cli 看到的字节不一定与 Java 源码中的字符串长得一样。

参考：[Redis 官方数据类型概览](https://redis.io/docs/latest/develop/data-types/)。本课只选上述稳定基础，不要求项目支持官网当前列出的全部新类型。

## 5. String 与 Hash 不要混为一谈

### String 示例

```text
SET lesson:r2:flag success
GET lesson:r2:flag
```

### Hash 示例

```text
HSET lesson:r2:order status CREATED userId 1001
HGET lesson:r2:order status
```

Hash 的 field 是该 key 内部的字段，不是另一个独立 key。GET 操作不能直接读取一个 Hash key 的完整 Java 业务对象；命令与数据类型需要匹配。

本课说 TTL 时主要讨论整个 key 的生存时间，不把某个 field 当作自动拥有完全相同的独立 key 生命周期。更细的能力要看实际版本和 API。

## 6. TTL：状态保留多久

TTL 是 time to live，表示过期相关的剩余时长。

| 命令或选项 | 含义 |
| --- | --- |
| EXPIRE key seconds | 给已有 key 设置秒级过期 |
| PEXPIRE key milliseconds | 毫秒级过期 |
| TTL key | 查看剩余秒数 |
| PTTL key | 查看剩余毫秒数 |
| SET key value EX seconds | 写值时同时设置秒级过期 |
| SET key value PX milliseconds | 写值时同时设置毫秒级过期 |

TTL / PTTL 的两个特殊结果：

- -1：key 存在，但没有过期时间。
- -2：key 不存在。

秒级结果 0 不是“不存在”的同义词；可能只是剩余时间不足一秒，具体观察需结合命令与时间流逝。

参考：[Redis 官方 TTL 文档](https://redis.io/docs/latest/commands/ttl/)。

### 到期不等于业务自动结束

锁状态到期，不会强制让旧持有者的 Java 线程停止；成功标记到期，也不会撤销数据库里已经完成的业务。

服务端的过期清理策略与某个时刻的物理内存回收不是一回事。应用按过期语义访问时不能依赖旧状态继续有效，也不应该把 TTL 理解成 Java 定时任务回调。

### 普通读取是否续期？

普通 GET 不会自动把 TTL 重置为原始时长。续期需要另有操作或客户端机制。Redisson 锁的 watchdog 不是“Redis 每次被读取就自动续期”，下一课再讲。

### 覆盖写入需要检查 TTL

对 Redis 普通 SET，不带保留或重新设置过期的相应选项时，覆盖写入会清除原 TTL。不能因为 key 曾设置过期，就认定后续所有写法都保留它。

具体 Java 封装是否提供其他行为，必须查看其调用的版本与方法，不把命令知识直接替代全部客户端实现。

## 7. 原子命令不等于多步业务原子

Redis 的一个普通 INCR 可以原子增加计数，但下面的两步不能自动变成一个整体：

```text
GET key → Java 判断 → SET key newValue
```

两个客户端仍可能都根据同一个旧值更新。上一课 AtomicInteger 的复合操作问题，在远程命令组合中同样需要分析。

另一个问题：

```text
SET key value
EXPIRE key 30
```

如果第一步成功、第二步没执行，可能留下没有过期时间的 key。把值和过期一起设置可以消除这个特定的两命令间隙。

但一次命令内部原子，不等于整个数据库业务、网络交互和消息发送构成同一个事务。

## 8. SET NX PX：一起表达“未存在时写入并设置过期”

概念命令：

```text
SET lesson:r2:lock token-A NX PX 5000
```

- NX：仅 key 不存在时写入。
- PX 5000：成功写入时设置 5000 毫秒过期。
- token-A：本次持有者的示例标识，不是业务固定常量。

NX 失败不表示成功替换了值或重新设置了旧值的 TTL。

这是理解简单协调协议的基础，**不是完整复刻 Redisson RLock**。重入、所有者、续期、等待通知、拓扑故障等都还未解决，不能把这一条命令当作所有场景下充分的锁实现。

参考：[Redis 官方 SET 命令](https://redis.io/docs/latest/commands/set/)。只使用 NX、EX、PX 等基础选项，不要求项目使用当前文档中的较新扩展。

## 9. 为什么释放时不能无条件 DEL？

考虑一条具体时间线：

```text
A 写入 token-A，租期 5 秒，继续执行业务
    ↓
A 的租期到期，但 Java 业务还没结束
    ↓
B 成功写入 token-B，成为新的持有者
    ↓
A 恢复后直接 DEL 同名 key
    ↓
B 的状态被 A 删除
```

所以释放时需要核对是否仍属于自己，并将“比较与删除”作为一个不可被穿插的步骤。

仅在 Java 中先 GET、相等再 DEL 仍有间隙：两条命令之间状态也可能变化。入门场景常用 Lua 比较并删除。

即使防止误删，也不代表旧业务写入已被阻止。租期与业务状态保护是进一步的问题，不能据此声称所有分布式故障已解决。

## 10. Lua：把相关 Redis 操作放到服务端组合

教学片段：

```lua
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
```

KEYS[1] 表示显式传入的 key，ARGV[1] 是普通参数中的持有者标识。它在一次脚本执行中完成检查与删除，避免客户端两条命令间被其他命令插入。

这是协议原理片段，不是本项目 Redisson 直接使用的完整解锁脚本；当前项目没有在 RedissonDataHandle 中手写它。

### 原子执行与回滚不同

脚本执行期间，相关服务端命令执行不会被其他普通客户端命令穿插。但运行错误不表示之前已经做的写入自动撤销。

脚本过长也会影响其他请求的处理，所以不应在 Lua 中安排不可控的长计算。集群访问还要考虑显式 key 声明与同槽等约束。

参考：[Redis 官方脚本说明](https://redis.io/docs/latest/develop/programmability/eval-intro/)。

## 11. Pipeline、Redis 事务、数据库事务不是同一个概念

| 机制 | 主要解决什么 | 不应直接推断 |
| --- | --- | --- |
| Pipeline | 批量发送命令，减少网络往返成本 | 命令组合自动不可被穿插 |
| MULTI / EXEC | 将一组排队的命令作为事务执行 | 任意运行错误都会像数据库事务一样全部回滚 |
| Lua | 服务端按条件组合读写逻辑 | 自动跨 Redis、数据库与消息事务 |
| 业务数据库事务 | 按数据库规则控制业务写入 | 自动覆盖另一个 Redis 服务里的状态 |

WATCH 可以参与 Redis 乐观并发检查，但不是看见这个名称就代表全部业务条件已经正确实现。

本课不展开完整 Redis 事务编程，先建立边界。后续读防重复切面时，还要判断成功标记写入与数据库提交谁先谁后。

参考：[Redis 官方事务说明](https://redis.io/docs/latest/develop/using-commands/transactions/)。

## 12. 发布订阅：通知不等于可靠消息存储

Redis Pub/Sub 允许客户端订阅频道，发布者把消息发给当前订阅者。普通 Pub/Sub 是至多一次交付：订阅端断开或无法处理期间，不能默认之后自动补齐历史消息。

在锁场景中，发布订阅可以用于通知等待者“状态可能改变，重新尝试获取”。收到通知不等于已经取得锁，真正的所有权仍要由获取操作确认。

Redisson 对应锁类型是否如何使用它，要看具体版本实现。也不要因为当前客户端没收到一条通知，就直接推断所有等待逻辑永久无法继续，等待超时和再次尝试还有自己的机制。

队列与 Pub/Sub 的差别也要分清：List 等队列结构中有待消费数据，不等于一定支持消费确认、失败重投与恰好一次处理。RBlockingQueue.take 更不等于 Kafka 消费确认。

参考：[Redis 官方 Pub/Sub 说明](https://redis.io/docs/latest/develop/pubsub/)。

## 13. 网络失败：没收到结果，不一定没执行

```text
客户端发命令 → Redis 已处理 → 响应返回途中连接断开
```

客户端可能看到超时，但服务端操作已经完成。也可能命令根本没送达。不能仅凭“本地没拿到成功响应”统一判断状态未改变。

这会影响锁获取重试、计数重试、重复提交和记录发送。重试前需要理解操作是否幂等、如何识别本次调用、错误属于哪一层。

本项目 useSingleServer 只描述客户端当前连接模式，不保证 Redis 永远不故障，也不能由这一行推出所有异常都会变成 tryLock=false。

## 14. 回到源码：RedissonDataHandle 做了什么？

文件：`damai-redisson-framework/damai-redisson-service-framework/damai-redisson-common-framework/src/main/java/com/damai/handle/RedissonDataHandle.java`。

### 简单读写

```java
public String get(String key) {
    return (String) redissonClient.getBucket(key).get();
}

public void set(String key, String value) {
    redissonClient.getBucket(key).set(value);
}
```

RBucket 是 Redisson 的单值对象接口，不是 Java 内存 Map。这里期望读出来的对象是 String，并没有提供任意类型的安全转换。

### 带 TTL 的写入

```java
redissonClient.getBucket(key).set(value, getDuration(timeToLive, timeUnit));
```

它先把数字与单位转成 Java Duration，再交给底层对象。要读懂 TTL，不能停在方法参数名字上，还要进入 getDuration。

### 一个真实单位边界

getDuration 当前只显式处理 MINUTES、HOURS、DAYS，其他单位全部走 Duration.ofSeconds。

| 调用参数 | 当前结果 | 与调用者按单位理解的结果是否一致 |
| --- | --- | --- |
| 2, MINUTES | 120 秒 | 一致 |
| 5, SECONDS | 5 秒 | 一致 |
| 500, MILLISECONDS | 500 秒 | 不一致，应是 0.5 秒 |
| 其他细粒度单位 | 也按秒处理 | 需核查，不能凭 TimeUnit 参数认为全支持 |

因此这不是通用的 TimeUnit 转换实现。后续应结合实际调用者判断有没有走到错误单位，不把潜在边界等同于已经证明某个线上请求受影响。

## 15. 防重复标记与队列状态先怎样对应？

RepeatExecuteLimitConstant 定义成功值 success，标记 key 前缀为 repeat_flag。切面用 key 找到 RBucket 中的成功标记，并在 durationTime>0 时尝试带 TTL 写入。

需要区分三份状态：

1. 正在执行期间的锁。
2. 表示近期已执行过的成功标记。
3. 数据库真正的业务结果。

其中某个 TTL 到期或写入失败，不会自动让另外两份状态回滚。

DelayBaseQueue 则使用 redissonClient.getBlockingQueue(relTopic)。这里是队列对象，不是 RBucket 标记；其内部结构、到期转移和消费恢复在延迟队列课程展开。

## 16. 独立实验：四组状态模型

本课不连接 Redis。下面是单线程、手动时钟的 Java 模型，帮助观察 TTL、NX 意图、旧持有者误删与项目单位转换。它不是 Redis 仿真实现，不验证真实命令原子性、网络、并发或过期清理调度。

模型 pttl 使用毫秒；通过 advance 人工推进时间，没有 sleep。D 中的 projectDuration 按当前源码分支提取，不加载真实 RedissonDataHandle。

保存为 `RedisBasicsStateDemo.java`，作为普通 JDK 17 main 运行。

```java
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class RedisBasicsStateDemo {
    record Entry(String value, Long expiresAt) {}

    static class Store {
        final Map<String, Entry> values = new HashMap<>();
        long now;

        Entry live(String key) {
            Entry entry = values.get(key);
            if (entry != null && entry.expiresAt() != null && entry.expiresAt() <= now) {
                values.remove(key);
                return null;
            }
            return entry;
        }

        String get(String key) {
            Entry entry = live(key);
            return entry == null ? null : entry.value();
        }

        void set(String key, String value) {
            values.put(key, new Entry(value, null));
        }

        void expire(String key, long ttlMillis) {
            Entry entry = live(key);
            if (entry != null) {
                values.put(key, new Entry(entry.value(), now + ttlMillis));
            }
        }

        boolean setNxWithTtl(String key, String value, long ttlMillis) {
            if (live(key) != null) {
                return false;
            }
            values.put(key, new Entry(value, now + ttlMillis));
            return true;
        }

        boolean compareDelete(String key, String owner) {
            if (owner.equals(get(key))) {
                values.remove(key);
                return true;
            }
            return false;
        }

        long pttl(String key) {
            Entry entry = live(key);
            if (entry == null) return -2;
            if (entry.expiresAt() == null) return -1;
            return entry.expiresAt() - now;
        }

        void advance(long millis) {
            now += millis;
        }
    }

    static Duration projectDuration(long value, TimeUnit unit) {
        return switch (unit) {
            case MINUTES -> Duration.ofMinutes(value);
            case HOURS -> Duration.ofHours(value);
            case DAYS -> Duration.ofDays(value);
            default -> Duration.ofSeconds(value);
        };
    }

    public static void main(String[] args) {
        System.out.println("-- A: TTL 与分步设置 --");
        Store ttl = new Store();
        System.out.println("不存在=" + ttl.pttl("flag"));
        ttl.set("flag", "success");
        System.out.println("只SET尚未EXPIRE=" + ttl.pttl("flag"));
        ttl.expire("flag", 5000);
        System.out.println("设置到期=" + ttl.pttl("flag"));
        ttl.advance(5001);
        System.out.println("到期后=" + ttl.pttl("flag"));

        System.out.println("-- B: NX 与覆盖写 --");
        Store nx = new Store();
        System.out.println("A取得=" + nx.setNxWithTtl("lock", "A", 5000));
        System.out.println("B取得=" + nx.setNxWithTtl("lock", "B", 5000));
        System.out.println("当前持有者=" + nx.get("lock"));
        nx.set("lock", "overwrite");
        System.out.println("普通覆盖后TTL=" + nx.pttl("lock"));

        System.out.println("-- C: 过期后的旧持有者 --");
        Store owner = new Store();
        owner.setNxWithTtl("lock", "A", 5000);
        owner.advance(5001);
        owner.setNxWithTtl("lock", "B", 5000);
        owner.values.remove("lock");
        System.out.println("A无条件删除后=" + owner.get("lock"));
        owner.setNxWithTtl("lock", "B", 5000);
        System.out.println("A比较删除=" + owner.compareDelete("lock", "A"));
        System.out.println("比较后持有者=" + owner.get("lock"));

        System.out.println("-- D: 项目Duration分支 --");
        System.out.println("2分钟的毫秒=" + projectDuration(2, TimeUnit.MINUTES).toMillis());
        System.out.println("传500毫秒实际毫秒=" + projectDuration(500, TimeUnit.MILLISECONDS).toMillis());
        System.out.println("是否等于期望500=" +
                projectDuration(500, TimeUnit.MILLISECONDS).equals(Duration.ofMillis(500)));
    }
}
```

预期输出：

```text
-- A: TTL 与分步设置 --
不存在=-2
只SET尚未EXPIRE=-1
设置到期=5000
到期后=-2
-- B: NX 与覆盖写 --
A取得=true
B取得=false
当前持有者=A
普通覆盖后TTL=-1
-- C: 过期后的旧持有者 --
A无条件删除后=null
A比较删除=false
比较后持有者=B
-- D: 项目Duration分支 --
2分钟的毫秒=120000
传500毫秒实际毫秒=500000
是否等于期望500=false
```

模型中的 compareDelete 没有真实并发，因此不能把它的 Java get/remove 两步直接复制到生产 Redis 代码。前文 Lua 的意义正是服务端原子比较并删除。

验证记录：本地 JDK 25 使用 `--source 17` 运行，四组实际输出与上述预期一致。没有连接 Redis，也没有验证真实命令、Lua、发布订阅或 Redisson 的远程行为。

## 17. 有 Redis 环境后可以观察什么？

只在明确的独立实验实例中，使用自己的 lesson 前缀 key，观察：

1. SET 后 TTL 为 -1，设置过期后变成剩余时间。
2. GET 前后 TTL 继续流逝，没有自动恢复为原时长。
3. SET NX PX 的竞争结果与实际 key 内容。
4. 普通 SET 覆盖后 TTL 是否保留。
5. Pub/Sub 订阅断开时的消息交付。

本课没有实际执行这些远程命令，也未验证本机 Redis 当前是否可启动。后续实验在环境可用时再做，不能把本地模型输出当作服务端日志。

## 18. 练习

1. Redis 可以先理解成 Java Map 吗？还必须补上什么区别？
2. key 名含冒号是否表示真的创建了目录？
3. Redis String 是否等于 Java String 的原始文本表示？
4. Hash 的 field 是独立 key 吗？
5. TTL=-1 与 -2 分别表示什么？TTL=0 是否必然不存在？
6. key 到期是否会自动停止原持有者的 Java 线程？
7. GET 是否默认续期？
8. SET 后再 EXPIRE，进程在中间失败可能留下什么？
9. NX 失败后，旧值和 TTL 是否因该失败操作自动被替换？
10. SET NX PX 是否已经实现完整 Redisson 可重入锁？
11. 为什么旧持有者不能直接 DEL？先 GET 再 DEL 就够了吗？
12. Lua 原子执行是否意味着运行错误自动回滚之前全部写入？
13. Pipeline、Lua 与数据库事务能否互换理解？
14. Pub/Sub 是否保证断线订阅者重连后收到历史消息？
15. 收到解锁通知是否说明已经取得锁？
16. 客户端超时是否能证明 Redis 没执行命令？
17. 当前 getDuration(500, MILLISECONDS) 得到多少秒？
18. 成功标记 TTL、锁租期与数据库事务是否同一生命周期？

## 19. 参考答案

### 1. Map 类比的限度

可以用 key 查值建立直觉，但要补上远程调用、数据类型、编码、过期和失败语义。get 不是本地字段访问。

### 2. key 的冒号

只是名称组织约定，不自动生成目录。参与者还要连接正确后端与命名空间。

### 3. 两种 String

不等同。Redis 存字节，Java 客户端通过 codec 编解码。肉眼查看的形式与 Java 对象值不必完全相同。

### 4. Hash field

它属于一个 Hash key 内的字段，不是另一个顶层独立 key。要使用匹配的数据类型命令与版本能力。

### 5. TTL 特殊值

-1 表示存在但无过期，-2 表示不存在；秒级 0 还可能表示不足一秒，不能简单等同不存在。

### 6. 到期与业务停止

不会自动停止线程。远程状态的有效期与本地业务执行是两条时间线，旧业务可能继续。

### 7. GET 与续期

普通 GET 不默认续期。续期需要额外操作或明确的客户端机制，不能和 watchdog 混为一谈。

### 8. 分步设置失败

可能已经写入值，却没有过期。使用合适的单次写入加过期可消除这个间隙，但不解决所有业务一致性。

### 9. NX 失败

该次条件写没有成功替换旧值，也不会因此更新旧 TTL。需要单独核查后续是否有其他命令修改状态。

### 10. 简单命令与 RLock

不是完整实现。还缺重入、所有者、续期、等待通知等协议与故障分析，应跟对应版本实现确认。

### 11. 释放时的所有者

旧租期可能已结束，新持有者已写入同名 key；无条件删除会误删。分开的 GET/DEL 仍有交错间隙，应按协议原子比较并删除。

### 12. Lua 与回滚

不是。原子执行约束交错，不保证运行错误撤销此前写入，也不构成跨系统事务。

### 13. 三种机制

不能互换。Pipeline 主要减少往返，Lua 组合服务端条件逻辑，数据库事务按数据库规则管理业务写入；各有不同边界。

### 14. Pub/Sub 历史消息

普通 Pub/Sub 不保证断线历史补投，是至多一次交付。若需要可靠消费，要选择并实现相应机制。

### 15. 通知与获取

通知只说明可能需要重新尝试，不会把所有权自动交给收到消息的每个等待者。

### 16. 超时与是否执行

不能证明。可能未送达，也可能已执行而响应丢失。重试必须理解幂等性与状态识别。

### 17. 当前单位转换

得到 500 秒，即 500000 毫秒；当前 default 按秒处理，不是期望的 0.5 秒。是否实际触发需继续看调用者。

### 18. 三种生命周期

不同。锁控制执行中的协调，标记表示一段时间内已处理过，数据库事务管理业务状态。它们不会仅因在同一切面里出现就自动原子提交或一起回滚。

## 20. 本课通关与下一课

请解释：同一 key 的值、过期与所有者分别是什么；为什么单条命令原子不等于业务整体原子；为什么超时、通知和 TTL 都不能代替确认业务完成。

下一课学习 Redisson 锁 API 与生命周期，正式区分 getLock、lock、tryLock、waitTime、leaseTime、watchdog 与 unlock，并映射到项目 ServiceLocker 的重载。

继续阅读：[第 03 课：Redisson 锁 API 与生命周期（含答案）](damai-redisson-framework-第03课-锁API与生命周期（含答案）.md)。
