"""
一键获取官方 YOLO26n 并导出为 SeerBrowserPro 可用的端到端 ONNX：
    1. pip 安装/升级 ultralytics
    2. 自动下载 yolo26n.pt（COCO 80 类预训练权重）
    3. export(format='onnx', nms=False)  -> 输出 (1,300,6)，无需 NMS

注意：COCO 类别不含游戏 UI 元素，该模型主要用于验证链路与检测画面中
人物/电视等通用物体；识别游戏按钮请用 train.py 在自定义数据上微调。

用法：
    python fetch_official.py [输出目录]
"""
import json
import os
import shutil
import subprocess
import sys


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join('models-local', 'official')
    os.makedirs(out_dir, exist_ok=True)

    print('[1/3] 安装 ultralytics …')
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-U', 'ultralytics'])

    print('[2/3] 下载 yolo26n.pt …')
    from ultralytics import YOLO

    model = YOLO('yolo26n.pt')  # 首次运行自动从官方源下载

    print('[3/3] 导出 ONNX（端到端无 NMS 头）…')
    exported = model.export(format='onnx', nms=False, opset=17, imgsz=640, simplify=True)

    dst = os.path.join(out_dir, 'yolo26n.onnx')
    shutil.copy(exported, dst)
    names = model.names  # {0: 'person', ...}
    classes = [names[i] for i in sorted(names)]
    with open(os.path.join(out_dir, 'classes.json'), 'w', encoding='utf-8') as f:
        json.dump(classes, f, ensure_ascii=False, indent=2)

    print(f'[OK] {dst}')
    print(f'[OK] classes: {len(classes)} -> {os.path.join(out_dir, "classes.json")}')


if __name__ == '__main__':
    main()
