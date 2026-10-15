/**
 * 必应壁纸离线兜底快照 —— **由脚本生成，请勿手改**。
 *
 * 生成脚本：`.workbuddy/tools/gen_bing_fallback.py`
 * 生成时间：2026-10-12 20:00（Asia/Shanghai）
 *
 * 为什么要有这个文件：
 *   必应图库接口不返回 Access-Control-Allow-Origin，扩展页面读它必须靠
 *   manifest 的 host 权限。权限没生效或网络不通时，实时接口一条路都走不通。
 *   这里在构建期把最近 8 天的地址烘焙进源码，运行时就永远有一份可用的列表；
 *   图片走 <img> 加载（不受 CORS 限制），所以只要有地址就一定能显示。
 *
 * 运行顺序：实时接口 → 本地缓存 → 本文件。它不是正常路径，只是安全网。
 * 想刷新内容就重新跑一次生成脚本。
 */
import type { BingImage } from '../types';

export const BING_FALLBACK_GENERATED_AT = "2026-10-12 20:00";

export const BING_FALLBACK_IMAGES: readonly BingImage[] = [
  {
    url: "https://www.bing.com/th?id=OHR.MumblesSwansea2026_ZH-CN5419531039_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.MumblesSwansea2026_ZH-CN5419531039",
    copyright: "曼布尔斯码头，斯旺西，威尔士 (© Helen Hotson/Shutterstock)",
    date: "2026-10-11",
  },
  {
    url: "https://www.bing.com/th?id=OHR.BabcockSP_ZH-CN5266848536_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.BabcockSP_ZH-CN5266848536",
    copyright: "格莱德溪磨坊，巴布科克州立公园，西弗吉尼亚州，美国 (© dszc/Getty Images)",
    date: "2026-10-10",
  },
  {
    url: "https://www.bing.com/th?id=OHR.CormorantsFlight_ZH-CN0770863330_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.CormorantsFlight_ZH-CN0770863330",
    copyright: "蒙特雷湾上空的双冠鸬鹚，加利福尼亚州，美国 (© Hiroya Minakuchi/Minden Pictures)",
    date: "2026-10-09",
  },
  {
    url: "https://www.bing.com/th?id=OHR.IlesSanguinaires_ZH-CN3149346035_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.IlesSanguinaires_ZH-CN3149346035",
    copyright: "桑吉奈尔群岛景观，摄自科西嘉岛，法国 (© Francesco Riccardo Iacomino/Getty Images)",
    date: "2026-10-08",
  },
  {
    url: "https://www.bing.com/th?id=OHR.MayotteOctopus_ZH-CN2837659998_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.MayotteOctopus_ZH-CN2837659998",
    copyright: "印度洋马约特岛，一只呈防御姿态的章鱼 (© Gabriel Barathieu/Minden Pictures)",
    date: "2026-10-07",
  },
  {
    url: "https://www.bing.com/th?id=OHR.ForestofDean_ZH-CN2654753621_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.ForestofDean_ZH-CN2654753621",
    copyright: "覆满苔藓的岩石，英国格洛斯特郡谜林，迪恩森林，格洛斯特郡，英格兰 (© Fulcanelli_AOS/Getty Images)",
    date: "2026-10-06",
  },
  {
    url: "https://www.bing.com/th?id=OHR.DanxiaLandform_ZH-CN2386060246_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.DanxiaLandform_ZH-CN2386060246",
    copyright: "丹霞地貌，张掖国家地质公园，甘肃省，中国 (© Weiquan Lin/Getty Images)",
    date: "2026-10-05",
  },
  {
    url: "https://www.bing.com/th?id=OHR.AdelieTeacher_ZH-CN2201820679_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp",
    urlbase: "/th?id=OHR.AdelieTeacher_ZH-CN2201820679",
    copyright: "南极洲的阿德利企鹅 (© Otto Plantema/Minden Pictures)",
    date: "2026-10-04",
  },
];
