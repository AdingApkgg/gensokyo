import { Languages, Moon, Search, Star, Sun, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import { m } from '~/paraglide/messages'
import { getLocale, locales, setLocale } from '~/paraglide/runtime'

export function meta() {
  return [{ title: '设计系统 · 幻想乡' }]
}

const swatches = [
  ['background', 'bg-background border'],
  ['card', 'bg-card border'],
  ['primary 朱', 'bg-primary'],
  ['secondary 樱', 'bg-secondary'],
  ['muted', 'bg-muted'],
  ['accent 金', 'bg-accent'],
  ['destructive', 'bg-destructive'],
] as const

const chartSwatches = [
  ['灵梦朱', 'bg-chart-1'],
  ['魔理沙金', 'bg-chart-2'],
  ['琪露诺苍', 'bg-chart-3'],
  ['紫', 'bg-chart-4'],
  ['早苗绿', 'bg-chart-5'],
] as const

const licenses = [
  ['允许分发', 'default'],
  ['授权转载', 'secondary'],
  ['已绝版', 'outline'],
  ['未标明', 'destructive'],
] as const

const mockResources = [
  {
    title: '东方栖霞园 ～ Murasa in the Moonlight',
    circle: '幻想乡交响乐团',
    type: '同人游戏',
    license: licenses[0],
    rating: 4.8,
  },
  {
    title: '绯想天则交响组曲 Vol.2',
    circle: '凋叶棕',
    type: '音乐专辑',
    license: licenses[1],
    rating: 4.6,
  },
  {
    title: '东方刚欲异闻 简体中文补丁 v1.2',
    circle: '雾雨汉化组',
    type: '汉化补丁',
    license: licenses[2],
    rating: 4.9,
  },
]

const mockRows = [
  ['东方虹龙洞 全角色攻略合集', '弹幕研究所', '莉格露', '2026-08-29'],
  ['上海爱丽丝幻乐团曲目全集索引', '音乐堂', '帕秋莉', '2026-08-28'],
  ['danmakufu ph3 中文教程（一）', '河童重工', '荷取', '2026-08-27'],
]

export default function UiShowcase() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {}
    setDark(next)
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{m.ui_title()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {m.ui_subtitle()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <Languages className="ml-1 size-4 text-muted-foreground" />
            {locales.map((l) => (
              <Button
                key={l}
                variant={getLocale() === l ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setLocale(l)}
              >
                {l === 'zh' ? '中' : l === 'ja' ? '日' : 'EN'}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={toggle}
            aria-label={m.theme_toggle()}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_palette()}</h2>
        <div className="flex flex-wrap gap-3">
          {swatches.map(([name, cls]) => (
            <div key={name} className="text-center">
              <div className={`h-14 w-24 rounded-lg ${cls}`} />
              <span className="mt-1 block text-xs text-muted-foreground">
                {name}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {chartSwatches.map(([name, cls]) => (
            <div key={name} className="text-center">
              <div className={`h-8 w-24 rounded-lg ${cls}`} />
              <span className="mt-1 block text-xs text-muted-foreground">
                {name}
              </span>
            </div>
          ))}
        </div>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_typography()}</h2>
        <h1 className="text-4xl font-bold">幻想郷は今日も平和</h1>
        <h2 className="mt-2 text-2xl font-semibold">
          博丽神社例大祭，第二十三回
        </h2>
        <p className="mt-3 max-w-prose leading-7">
          香霖堂收藏着从外界流入幻想乡的物品。这里是中文东方众的资源与数据基础设施——
          同人游戏、音乐专辑、汉化补丁与工具素材，先发后审，尊重每一个社团的分发意愿。
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          标题用思源宋体（Noto Serif SC），正文用 Geist × 思源黑体。
        </p>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_buttons()}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Upload /> 上传资源
          </Button>
          <Button variant="secondary">收藏</Button>
          <Button variant="outline">
            <Search /> 检索
          </Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="destructive">申请下架</Button>
          <Button variant="link">查看社团页</Button>
          <Button size="sm">小</Button>
          <Button size="lg">大</Button>
        </div>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_badges()}</h2>
        <div className="flex flex-wrap gap-2">
          {licenses.map(([name, variant]) => (
            <Badge key={name} variant={variant}>
              {name}
            </Badge>
          ))}
        </div>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_cards()}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {mockResources.map((r) => (
            <Card key={r.title}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{r.type}</Badge>
                  <Badge variant={r.license[1]}>{r.license[0]}</Badge>
                </div>
                <CardTitle className="mt-2 leading-snug">{r.title}</CardTitle>
                <CardDescription>{r.circle}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Star className="size-4 fill-chart-2 text-chart-2" />
                  {r.rating} · 1,024 次下载
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button size="sm" className="flex-1">
                  下载
                </Button>
                <Button size="sm" variant="outline">
                  详情
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_tabs()}</h2>
        <Tabs defaultValue="kourindou">
          <TabsList>
            <TabsTrigger value="kourindou">{m.nav_kourindou()}</TabsTrigger>
            <TabsTrigger value="shrine">{m.nav_shrine()}</TabsTrigger>
            <TabsTrigger value="chronicle">{m.nav_chronicle()}</TabsTrigger>
          </TabsList>
          <TabsContent value="kourindou" className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead>板块</TableHead>
                  <TableHead>作者</TableHead>
                  <TableHead className="text-right">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockRows.map(([title, board, author, date]) => (
                  <TableRow key={title}>
                    <TableCell className="font-medium">{title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{board}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">
                            {author?.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                        {author}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {date}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent
            value="shrine"
            className="mt-4 text-sm text-muted-foreground"
          >
            版块 → 主题 → 楼层。资源评论与论坛帖同源。
          </TabsContent>
          <TabsContent
            value="chronicle"
            className="mt-4 text-sm text-muted-foreground"
          >
            TouhouDB 中文层：原曲 ↔ 专辑 ↔ 社团 ↔ 展会。
          </TabsContent>
        </Tabs>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-4 text-xl font-semibold">{m.section_form()}</h2>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>投稿到香霖堂</CardTitle>
            <CardDescription>先发后审 · 请如实标注分发许可</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">标题</Label>
              <Input id="title" placeholder="例：东方妖々梦 体验版镜像" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>类型</Label>
                <Select defaultValue="game">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="game">同人游戏</SelectItem>
                    <SelectItem value="music">音乐专辑</SelectItem>
                    <SelectItem value="patch">汉化补丁</SelectItem>
                    <SelectItem value="tool">工具素材</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>许可状态</Label>
                <Select defaultValue="allowed">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowed">社团明示允许</SelectItem>
                    <SelectItem value="unknown">未标明</SelectItem>
                    <SelectItem value="oop">已绝版</SelectItem>
                    <SelectItem value="licensed">授权转载</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="desc">简介</Label>
              <Textarea id="desc" placeholder="出处、版本、注意事项……" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="notify" defaultChecked />
              <Label htmlFor="notify">审核结果通知我</Label>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Dialog>
              <DialogTrigger render={<Button />}>
                <Upload /> 提交
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>确认投稿？</DialogTitle>
                  <DialogDescription>
                    资源将立即公开，并进入审核队列。若许可状态填写不实，可能被下架并影响信任等级。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">再想想</Button>
                  <Button>确认</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="ghost">存草稿</Button>
          </CardFooter>
        </Card>
      </section>

      <Separator className="my-8" />

      <section className="pb-16">
        <h2 className="mb-4 text-xl font-semibold">{m.section_loading()}</h2>
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </section>
    </div>
  )
}
