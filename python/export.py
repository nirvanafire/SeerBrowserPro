"""
将训练好的 YOLO26 检测模型导出为 SeerBrowserPro 可用的 ONNX：
    python export.py --weights runs/detect/seer_game_ui/weights/best.pt --out models-local/custom

默认导出 nms=False 端到端头（输出 1x300x6，onnxruntime-node 后处理最简单）；
加 --standard 导出默认一对多头（输出 1x(4+nc)x8400，应用端内置 NMS）。
导出后在应用「模型」面板导入 .onnx（同目录放 classes.json 可一并选择）。
"""
import argparse
import json
import os
import shutil


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', required=True)
    parser.add_argument('--out', default='models-local/custom')
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--standard', action='store_true', help='导出默认 NMS 头而非端到端头')
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    from ultralytics import YOLO

    model = YOLO(args.weights)
    exported = model.export(
        format='onnx',
        nms=not args.standard,
        opset=17,
        imgsz=args.imgsz,
        simplify=True,
    )

    base = os.path.splitext(os.path.basename(args.weights))[0]
    dst = os.path.join(args.out, base + ('_std.onnx' if args.standard else '_e2e.onnx'))
    shutil.copy(exported, dst)

    names = model.names
    classes = [names[i] for i in sorted(names)]
    with open(os.path.join(args.out, 'classes.json'), 'w', encoding='utf-8') as f:
        json.dump(classes, f, ensure_ascii=False, indent=2)

    print(f'[OK] ONNX: {dst}')
    print(f'[OK] classes({len(classes)}): {os.path.join(args.out, "classes.json")}')


if __name__ == '__main__':
    main()
