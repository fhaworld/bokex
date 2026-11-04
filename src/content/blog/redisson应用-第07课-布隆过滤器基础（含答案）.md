---
title: "redisson应用-第07课-布隆过滤器基础（含答案）"
description: "redisson应用系列第07课，主题：布隆过滤器基础（含答案）。"
pubDate: "2026-11-04"
tags: ["Redisson", "学习笔记"]
featured: false
---
# 第 07 课：布隆过滤器基础（含答案）

## 1. 本课目标

前面几课学习了锁与重复处理。本课换一个问题：**大量请求查询根本不存在的数据时，怎样先用较小空间做一次筛查？**

学完应能解释位数组、多个哈希、假阳性、容量与误判率，并正确理解项目 BloomFilterHandler 的 add、contains、tryInit 与 count。

本课先讲原理与项目用途，完整配置和业务源码跟读在第 14 课展开。

课程入口：[学习导航](damai-redisson-framework-课程学习导航.md)。

## 2. 为什么需要一次预筛查？

以节目 ID 查询为例：

```text
请求查询不存在的节目
    → 缓存查不到
    → 数据库也查不到
    → 下一次不同的不存在 ID 又来
```

如果大量无效查询持续绕过普通缓存并访问数据库，就会增加无意义的后端负担。这是缓存穿透的一种常见情况。

可以先用一个表示“可能存在的 ID 集合”的过滤器：

```text
请求 ID → 布隆判断
    ├── 未命中 → 按业务前提决定能否提前结束
    └── 可能存在 → 继续缓存、数据库或其他真实校验
```

布隆过滤器不负责保存完整节目详情，也不会自动替你更新缓存或数据库。

## 3. 为什么不直接存一个 HashSet？

HashSet 可以按实际成员进行精确判断，但需要存储元素及相关结构。超大集合的内存和远程存储成本可能值得优化。

布隆过滤器用位数组和哈希映射压缩成员信息，以牺牲部分判断精度换取较小空间。

| 能力 | 普通精确集合 | 标准布隆过滤器 |
| --- | --- | --- |
| 判断成员 | 按集合中的实际元素匹配 | 基于位状态判断可能存在 |
| 枚举原始元素 | 通常可以 | 不能仅从位数组还原全部原元素 |
| 精确成员计数 | 通常可以 | 不天然提供，只能按实现估计等 |
| 删除单个元素 | 通常可以 | 不能简单清除对应位 |
| 精度 | 精确成员语义 | 允许假阳性 |

这里讨论标准追加型布隆结构，不把计数布隆等其他变体都当成相同能力。

## 4. 位数组怎样记录一个元素？

假设有 8 个 bit，初始全部为 0：

```text
下标：0 1 2 3 4 5 6 7
状态：0 0 0 0 0 0 0 0
```

元素 A 经过两个哈希，得到位置 1 与 4。插入后：

```text
下标：0 1 2 3 4 5 6 7
状态：0 1 0 0 1 0 0 0
```

插入 B，映射到 2 与 7，则继续把这两个 bit 置 1。它不记录“1 号位专属于 A”，位可以被很多元素共同使用。

哈希在这里用于产生稳定的位置，不是签名或加密。相同数据与相同映射规则应得到一致位置；改变编码、过滤器名称或配置，可能就不是原来那份成员判断。

## 5. 查询规则与两类结果

查询 X 时，计算它的多个位置：

- 至少有一位是 0：在当前过滤器状态与规则下，没有完整命中。
- 全部是 1：可能插入过，也可能对应位恰好都被其他元素置为 1。

第二种错误地把未加入元素判为可能存在，称为**假阳性**，也常叫误判。

例如从未加入 C，但它恰好映射到 A 的两个位置 1 与 4，查询就会返回 true。

因此 contains=true 不等于数据库里有这条记录。

## 6. “没有假阴性”必须说清参照对象

对正确使用的标准追加型布隆过滤器，已成功加入的元素，在位未丢失、配置与编码一致、没有错误清除等前提下，不会被判断为未命中。

这个性质的参照对象是**已加入这份过滤器的元素**，不是“数据库里可能有但从来没加载进来的全部记录”。

```text
数据库存在节目 1002
    ↓ 尚未加载到过滤器
过滤器查询 1002 返回 false
```

这可能是数据维护问题，并不推翻标准布隆算法关于已插入集合的性质。

如果业务把 false 直接当作数据库不存在，就必须自己建立并维护数据库数据与过滤器之间的覆盖关系。

## 7. 误判率 1% 到底是什么意思？

falseProbability=0.01 是设计时针对不属于集合的查询允许的目标假阳性概率，不表示：

- 所有请求固定有 1% 返回错。
- 每 100 次一定恰好错 1 次。
- 返回 true 的结果里恰好 1% 是假的。

举例：假设有 100 个真实存在的查询、10000 个不存在的查询。在某次符合近似条件的统计中，若约 1% 的不存在查询误判，就可能有约 100 个假阳性。总共约 200 个阳性里，假的占比可能接近一半。

这是帮助理解分母的估算例子，不是对某次运行的精确结果保证。

实际插入规模、哈希分布、位数组大小和查询分布都会影响表现。

## 8. 容量、位数与哈希次数

先认识三个量：

| 符号 | 含义 |
| --- | --- |
| n | 预计插入的不同元素规模 |
| m | 位数组大小，单位 bit |
| k | 每个元素的哈希位置数量 |

在常见理想化近似下，给定目标误判率 p：

```text
m ≈ -n × ln(p) / (ln(2)²)
k ≈ (m / n) × ln(2)
```

不要求背公式，先理解方向：容量越大，通常需要更多位；误判率要求越小，通常也需要更多位。k 不是越大越好，过多映射也有成本和效果问题。

以 n=20000、p=0.01 粗估，约需 191700 bit，即约 23.4 KiB 位空间，k 约为 7。这里只估位数组，不含配置、Redis key 与客户端对象等额外开销；具体实现的取整也可能不同。

getSize 返回 bit，不要直接当作字节。count 也不能由 set 为 1 的位数简单当作精确成员数。

## 9. 超过预计容量，不等于自动拒绝新元素

expectedInsertions 是用于初始化计算规模的参数，不是业务上的“最多只能添加 N 次”的默认硬配额。

固定大小结构插入更多不同元素时，置 1 的位越来越多，误判率可能上升。极端情况下位全为 1，任何查询都会命中，过滤作用就很差。

不能假设超出预计容量就必定自动扩容且保持原误判率；要看具体 API 与版本。

也不能按 add 的调用次数直接判断容量：重复加入同一元素通常不会像新增独立成员一样持续增加位占用。

## 10. 为什么不能直接删除某个元素的位？

A 和 B 可能共享某些置为 1 的位置。删除 B 时直接把它对应的 bit 清为 0，可能破坏 A 的判断，制造对已加入且仍应保留成员的假阴性。

```text
A 使用位置 1、4
B 也使用位置 1、4
    ↓ 删除 B 时直接清 1、4
A 被错误判断为不在过滤器里
```

因此标准布隆不支持这种简单的单元素删除。重建、带计数的变体等是另一个设计问题；不要在项目外手工改位就以为安全删除了一个 ID。

数据库删除一条记录后，旧位保留可能只是继续产生阳性，再由真实查询判不存在。是否需要清理、重建和数据版本切换，要结合业务规模与维护方式设计。

## 11. Redisson 对象与 Redis 原生 BF 命令要分开

本项目使用 redissonClient.getBloomFilter(...) 返回 RBloomFilter<String>。

本地 Redisson 3.32.0 JAR 的接口与字节码中，可看到 RBloomFilter 方法，以及实现通过脚本、Hash 配置与 GETBIT / SETBIT 等处理状态的路径。

因此不能把项目的这个对象直接等同于 redis-cli 中的 BF.ADD、BF.EXISTS，也不能据此要求项目必定使用 Redis 原生 Bloom 模块命令。

官方参考：[Redisson 概率结构](https://redisson.pro/docs/data-and-services/probabilistic-structures/)。官网当前还包含其他版本或实现能力，本文不把新增对象当作 3.32.0 已使用的 API。

原理可参考 [Redis 官方布隆概念说明](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/)，其中命令示例属于其相应实现，不能不加区别地替换项目客户端调用。

## 12. 项目配置与初始化，分两层看

### 第一层：初始化过滤器参数

BloomFilterProperties 默认：

```text
name：没有在字段处给出固定业务名称
expectedInsertions：20000
falseProbability：0.01
```

节目服务 application.yml 当前显式配置了 name=program-detail-bloom-filter、expectedInsertions=1000、falseProbability=0.01。不能把属性类默认 20000 当作所有业务运行值。

BloomFilterHandler 构造器：

```java
RBloomFilter<String> filter = redissonClient.getBloomFilter(
        SpringUtil.getPrefixDistinctionName() + "-" + properties.getName());
filter.tryInit(properties.getExpectedInsertions(), properties.getFalseProbability());
```

这是缩短局部变量的阅读片段。tryInit 是尝试初始化参数，不是自动查询数据库并加入全部元素。

如果对象已经初始化，tryInit 返回 false 可以表示已有初始化状态，而不一定是故障。当前封装没有根据返回值实现自动清空、迁移或按新 YAML 重建。

### 第二层：加载实际成员

ProgramBloomFilterInit.executeInit 调用 getAllProgramIdList，然后逐项 add(String.valueOf(programId))。

配置参数与加载数据库成员是两件事。组件构造成功不自动证明所有节目 ID 已经加入；初始化任务何时执行、是否失败与入口何时可接受请求，要继续看项目初始化框架。

用户初始化 UserBloomFilterInitData 还通过 BusinessThreadPool 提交加载任务。提交返回不等于所有手机号加载完成，这是后续源码课要核对的时间边界。

## 13. add、contains 与 count 的真实含义

BloomFilterHandler 是对底层方法的直接委托：

| 方法 | 应怎样读 | 不应怎样读 |
| --- | --- | --- |
| add(data) | 将相应哈希位设置为已加入状态，返回值反映底层是否有新增位等判定 | false 就精确证明该元素曾真实加入 |
| contains(data) | 全部位置是否命中，阳性表示可能存在 | true 就精确证明数据库存在 |
| getExpectedInsertions() | 初始化时保存的预计规模 | 当前精确元素数量 |
| getFalseProbability() | 初始化配置的目标误判参数 | 实时对所有请求测出的错误比例 |
| getSize() | 位数组大小，单位 bit | Redis 对象的全部字节内存 |
| getHashIterations() | 使用的哈希迭代数量 | 插入次数 |
| count() | 基于位状态估计成员规模 | 数据库精确行数或调用次数 |

一个未加入过的元素如果全部位置已被其他元素覆盖，add 也可能返回 false。这就是为什么不能用 add 的布尔返回值代替精确去重表。

## 14. 两个业务用法：同一数据结构，不同判断职责

### 节目详情：阴性时拒绝

ProgramBloomFilterCheckHandler 使用：

```java
boolean contains = bloomFilterHandler.contains(String.valueOf(param.getId()));
if (!contains) {
    throw new DaMaiFrameException(BaseCode.PROGRAM_NOT_EXIST);
}
```

这使“成员是否已完整加载、增量是否正确维护”成为重要业务前提。阳性只通过这一道检查，不证明后面一定能读到节目。

### 手机号存在检查：阳性后仍查数据库

UserService.doExist 中，contains=true 时会查询 UserMobile，只有确实取得记录才抛 USER_EXIST。它没有直接把布隆 true 当成手机号必定已注册。

注册路径在插入相关用户数据后调用 bloomFilterHandler.add。数据库事务、过滤器写入和失败恢复并不因此自动成为一份原子状态，后续还需要结合事务与补偿阅读。

不要把这两处用法推成一个“布隆结果就是业务事实”的统一规则。

## 15. 数据维护是算法之外的另一半

需要分别核对：

1. 初始加载是否覆盖所有应存在数据。
2. 加载完成前，业务是否已开始依赖阴性结果。
3. 新增数据何时加入，失败后如何恢复。
4. 数据库回滚而过滤器已加位时，后续怎样确认业务事实。
5. 删除、重建、切换名称或配置时，查询与写入是否使用同一版本。
6. 写入与查询的编码、前缀和数据规范化是否一致。

例如数据库 ID 相同，但一处使用 "001"、另一处使用 "1"，字符串字节可能不同；不能要求布隆自动理解业务上的数字等价。

本课不据此修改项目策略，只学会识别影响结果的前提。

## 16. 独立实验：六组可控位数组模型

下面只用 JDK 17 的 BitSet。故意使用 8 位数组和两个很简单的映射，制造确定的碰撞，不模拟 Redisson 的真实哈希与网络。

模型用于观察存在判断、假阳性、add 返回值、饱和、错误删除与漏加载。它不具备配置误判率保证，也不用于生产。

容量计算另用常见公式并向上取整，便于教学；不声明结果与 Redisson 3.32.0 的 getSize 取整完全相同。

保存为 `BloomBasicsDemo.java`，作为普通 main 运行。

```java
import java.util.BitSet;
import java.util.Set;

public class BloomBasicsDemo {
    static class TinyBloom {
        final BitSet bits = new BitSet(8);

        int[] positions(int value) {
            return new int[]{Math.floorMod(value, 8), Math.floorMod(3 * value + 1, 8)};
        }

        boolean add(int value) {
            boolean changed = false;
            for (int position : positions(value)) {
                if (!bits.get(position)) changed = true;
                bits.set(position);
            }
            return changed;
        }

        boolean contains(int value) {
            for (int position : positions(value)) {
                if (!bits.get(position)) return false;
            }
            return true;
        }

        void unsafeClear(int value) {
            for (int position : positions(value)) bits.clear(position);
        }
    }

    static long estimatedBits(long n, double p) {
        return (long) Math.ceil(-n * Math.log(p) / (Math.log(2) * Math.log(2)));
    }

    public static void main(String[] args) {
        System.out.println("-- A: 添加与查询 --");
        TinyBloom basic = new TinyBloom();
        System.out.println("首次add1=" + basic.add(1));
        System.out.println("contains1=" + basic.contains(1));
        System.out.println("contains2=" + basic.contains(2));

        System.out.println("-- B: 假阳性与add返回值 --");
        Set<Integer> actuallyAdded = Set.of(1);
        System.out.println("9实际加入过=" + actuallyAdded.contains(9));
        System.out.println("contains9=" + basic.contains(9));
        System.out.println("随后add9=" + basic.add(9));

        System.out.println("-- C: 位数组饱和 --");
        TinyBloom saturated = new TinyBloom();
        for (int i = 0; i < 8; i++) saturated.add(i);
        System.out.println("已置位数量=" + saturated.bits.cardinality());
        System.out.println("未加入999也命中=" + saturated.contains(999));

        System.out.println("-- D: 直接清位破坏其他成员 --");
        TinyBloom deletion = new TinyBloom();
        deletion.add(1);
        deletion.add(9);
        deletion.unsafeClear(9);
        System.out.println("仍应保留的1命中=" + deletion.contains(1));

        System.out.println("-- E: 数据库有值但未加载 --");
        Set<Integer> database = Set.of(1, 2);
        TinyBloom partiallyLoaded = new TinyBloom();
        partiallyLoaded.add(1);
        System.out.println("数据库存在2=" + database.contains(2));
        System.out.println("过滤器命中2=" + partiallyLoaded.contains(2));

        System.out.println("-- F: 容量近似计算 --");
        long bits = estimatedBits(20000, 0.01);
        long hashes = Math.max(1L, Math.round((double) bits / 20000 * Math.log(2)));
        System.out.println("教学位数=" + bits);
        System.out.println("近似哈希次数=" + hashes);
        System.out.println("更低误判率需要更多位=" + (estimatedBits(20000, 0.001) > bits));
    }
}
```

预期输出：

```text
-- A: 添加与查询 --
首次add1=true
contains1=true
contains2=false
-- B: 假阳性与add返回值 --
9实际加入过=false
contains9=true
随后add9=false
-- C: 位数组饱和 --
已置位数量=8
未加入999也命中=true
-- D: 直接清位破坏其他成员 --
仍应保留的1命中=false
-- E: 数据库有值但未加载 --
数据库存在2=true
过滤器命中2=false
-- F: 容量近似计算 --
教学位数=191702
近似哈希次数=7
更低误判率需要更多位=true
```

观察 B：未真正插入过的元素也能命中，随后 add 不新增位也可能返回 false。观察 E：算法并没有负责扫描数据库，它只知道你给它加入的内容。

unsafeClear 是故意展示错误的方法，不是项目提供的安全删除 API。模型也没有并发安全与真实误判率评估，不能据它推断 Redisson 性能或实现完全相同。

验证记录：本地 JDK 25 使用 `--source 17` 运行，六组实际输出均与讲义一致。未连接 Redis，也未运行真实 RBloomFilter 的容量、误判率或并发集成实验。

## 17. 练习

1. 布隆过滤器保存完整节目记录吗？
2. contains=true 是否表示数据库必定存在？
3. contains=false 是否无需任何前提就能证明数据库不存在？
4. “没有假阴性”的集合参照是什么？
5. falseProbability=0.01 是否表示所有阳性结果中固定 1% 是假的？
6. 每 100 次查询是否必定正好一次误判？
7. expectedInsertions=20000 是第 20001 次 add 必定失败的硬上限吗？
8. 同样容量要求更低误判率，通常需要更多还是更少位？
9. 哈希次数是否越多越好？
10. getSize 的单位是字节吗？count 是精确数据库行数吗？
11. add 返回 false 是否证明这个元素之前一定加入过？
12. 为什么标准布隆不能直接清掉删除元素对应的位？
13. tryInit 是否会自动把全部数据库 ID 加载进去？
14. 修改 YAML 的容量后，现有 Redis 对象是否必定自动重建？
15. 属性类默认 20000，节目服务是否必定也使用 20000？
16. ProgramBloomFilterCheckHandler 在哪种结果下拒绝？
17. UserService.doExist 收到 true 是否立即认定手机号存在？
18. 将初始化加载提交到线程池，是否表示返回时数据已全部加载？
19. 本项目 getBloomFilter 能否不加区分等同 BF.ADD 原生命令？
20. 本课实验是否验证了真实 Redisson 误判率、并发与网络行为？

## 18. 参考答案

### 1. 是否保存业务对象

不保存完整节目记录。它主要存成员映射的位状态及相关配置，不能还原全部详情或枚举所有原元素。

### 2. 阳性结果

只表示可能存在，可能因其他元素覆盖相应位而假阳性，后续仍需要真实业务确认。

### 3. 阴性与数据库

不能脱离数据完整性。数据库记录若未加载、前缀或编码不同、状态丢失，业务可能误判；过滤器不会自动知道所有数据库数据。

### 4. 无假阴性的前提

指已成功加入同一过滤器的元素，在状态、配置、编码等保持正确且没有错误清位等条件下不会漏判，不覆盖从未加入的记录。

### 5. 误判率分母

不是固定的阳性结果错误占比。设计目标通常针对不存在元素的查询；阳性中假的比例还受查询中真实存在与不存在的比例影响。

### 6. 概率不等于固定配额

不保证恰好一次。具体结果受数据、哈希、容量和查询影响，应以概率与实际统计理解。

### 7. 预计容量

不是默认硬配额，超出预计独立成员规模可能使位更密集、误判率变差，也不能假定自动扩容保持目标。

### 8. 空间方向

同样预计容量下，更低误判率通常需要更多位，不能同时无条件获得更小空间与更低误判。

### 9. 哈希次数

不是越多越好。它与位数和容量相关，也增加计算与访问成本，需按结构参数选择。

### 10. 位数与估计数

getSize 是 bit 数，不是总内存字节；count 是概率估计，不是数据库精确行数或 add 调用次数。

### 11. add=false

不能精确证明曾加入。未加入过的元素也可能所有位置早已被其他元素置 1，从而不产生新位。

### 12. 错误删除

位被多个元素共享，清除某个元素的位可能破坏其他仍应存在元素的判断，产生假阴性。

### 13. 参数初始化与数据加载

不同。tryInit 负责过滤器参数，实际成员由项目初始化任务等调用 add 加入。

### 14. 已有对象与新配置

不保证自动重建。tryInit 可因已有初始化而返回 false；当前封装没有据此实现通用清空、迁移与重建。

### 15. 默认值与运行值

不是，节目服务当前 YAML 明确配置 expectedInsertions=1000，实际还可能被外部配置覆盖。

### 16. 节目检查结果

contains=false 时抛 PROGRAM_NOT_EXIST，true 只是通过这道检查。这使成员加载覆盖成为重要前提。

### 17. 手机号真实确认

不会仅据 true 立即认定，当前还查 UserMobile，确有记录才抛 USER_EXIST。

### 18. 异步加载完成时刻

提交返回不等于任务完成或全部数据可用，要检查初始化生命周期、任务失败与请求开放时机。

### 19. 两类实现

不能混同。当前 Redisson 3.32.0 的相应对象使用自己的脚本和位等实现路径，官网原生 BF 命令示例属于另一层 API。

### 20. 实验范围

没有连接 Redis，只验证教学位数组和公式计算。未验证实际客户端、真实误判率、并发、性能或网络行为。

## 19. 本课通关与下一课

解释三个场景：未插入 ID 却返回 true、数据库有记录但未加载而返回 false、现有 Redis 过滤器未因配置修改自动重建。分别指出算法、数据维护与配置的责任。

下一课：[第 08 课：延迟队列与消费基础（含答案）](damai-redisson-framework-第08课-延迟队列与消费基础（含答案）.md)，讲清到期转移、阻塞 take、线程池与失败恢复，为 DelayProduceQueue、DelayConsumerQueue 源码做准备。
