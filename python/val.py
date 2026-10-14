"""
YOLO26 模型验证：
    python val.py --weights runs/detect/seer_game_ui/weights/best.pt --data dataset/data.yaml
可加 --nms/--no-nms 对比一对多头与端到端头的指标。
"""
import argparse


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--no-nms', action='store_true', help='使用端到端无 NMS 头验证')
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.weights)
    metrics = model.val(data=args.data, imgsz=args.imgsz, nms=not args.no_nms)
    print(f"mAP50-95: {metrics.box.map:.4f}  mAP50: {metrics.box.map50:.4f}")


if __name__ == '__main__':
    main()
