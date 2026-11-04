# 月下时计 · 表盘生成提示词

## 图片规格

- 尺寸：1024 × 1024，1:1。
- 格式：优先透明背景 PNG，四角完全透明。
- 构图：严格正面，圆心位于 (512, 512)，圆盘直径约 940 px，四周各留约 42 px 透明边距。
- 网页显示：桌面约 232 px，手机约 222 px；使用高分辨率原图保证清晰。
- 图片只画材质、圆环和装饰。刻度、罗马数字、中心轴和三根指针由代码叠加。

## 正向提示词

为一个月夜风格个人博客制作精致的圆形时钟表盘底图，1024×1024，1:1，透明背景 PNG。严格正面、正交视角、完美正圆，无透视，无倾斜。圆心精确位于画布中心，表盘直径占画布约92%，四周保留等宽的透明边距。

整体是安静、清冷、克制的日式幻想视觉小说氛围。午夜藏蓝与冷银蓝为主色，深蓝半透明磨砂玻璃盘面，极细的冷银金属外环，两三层若隐若现的同心蚀刻环，盘面深处有淡淡的云雾纹理和细微星尘。光源来自左上方，沿外圈形成柔和、连续、自然衰减的月光，不要清晰扩张的光圈。银白高光柔和细腻，局部有轻微的蓝色玻璃折射，整体保持低亮度，让后续叠加的银白色指针清晰可读。

装饰集中在外圈最边缘，少量纤细的月相几何雕纹，细节精致但不繁复。中央区域干净、深色、低对比度；在圆心附近留出充足空白。所有设计围绕圆心对称，缩小到230像素仍然清晰。输出只有单独的圆形表盘底图，圆盘外部完全透明。

不要画任何指针、数字、字母、文字、分钟刻度、小时刻度、中心轴、品牌、商标或水印。不要整只手表，不要表带，不要支架，不要室内场景，不要人物，不要已有游戏标志。

## 负向提示词

clock hands, hour hand, minute hand, second hand, numerals, numbers, text, letters, tick marks, center pin, logo, watermark, watch strap, stand, perspective, tilted, oval, off-center, cropped circle, asymmetric frame, neon cyberpunk, purple magenta, golden brass, steampunk gears, ornate baroque, high contrast center, bright white center, hard expanding rings, rectangular background, checkerboard background

## 放入网站

生成后将文件命名为 `moon-clock-face.png`，放在 `public/images/` 中，刷新本地首页即可识别。图片不含指针与刻度，程序会准确地叠加，并显示访问者设备的本地时间。正式网站在重新构建和发布后更新。

若生成工具不支持透明背景，可以让它输出四周纯深蓝 `#0a1729` 的正方形图片，再交给我处理接入。
