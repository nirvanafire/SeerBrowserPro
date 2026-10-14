"""
生成离线演示用的假 YOLO26 ONNX 模型（端到端头，输出 1x300x6）。

用途：在无法下载官方模型的环境中，验证
截图 -> 预处理 -> ONNX 推理 -> e2e 解码 -> 坐标还原 -> 覆盖层 全链路。

输出张量恒为若干固定位置的高置信度框（class 0 = 'target'），
不具备真实识别能力，请勿用于实际自动化。

用法：
    pip install onnx numpy
    python make_dummy_model.py <输出 onnx 路径>
"""
import os
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def build(out_path: str) -> None:
    max_det = 300

    # 12 个固定框，网格铺满 640x640（xyxy 坐标）
    boxes = np.zeros((max_det, 4), dtype=np.float32)
    cols, rows = 4, 3
    bw, bh = 120.0, 90.0
    gap_x = (640 - cols * bw) / (cols + 1)
    gap_y = (640 - rows * bh) / (rows + 1)
    k = 0
    for r in range(rows):
        for c in range(cols):
            x1 = gap_x + c * (bw + gap_x)
            y1 = gap_y + r * (bh + gap_y)
            boxes[k] = [x1, y1, x1 + bw, y1 + bh]
            k += 1

    scores = np.zeros((max_det, 1), dtype=np.float32)
    scores[:k] = 0.90  # e2e 头输出的分数已是概率值

    class_ids = np.zeros((max_det, 1), dtype=np.float32)

    boxes_const = numpy_helper.from_array(boxes, name='dummy_boxes')
    scores_const = numpy_helper.from_array(scores, name='dummy_scores')
    cls_const = numpy_helper.from_array(class_ids, name='dummy_cls')

    # images(1,3,640,640) -> Identity -> debug（仅用于让输入被图引用）
    inp = helper.make_tensor_value_info('images', TensorProto.FLOAT, [1, 3, 640, 640])
    identity = helper.make_node('Identity', ['images'], ['debug'], name='keep_input')

    concat = helper.make_node(
        'Concat',
        ['boxes_v', 'scores_v', 'cls_v'],
        ['rows'],
        axis=1,
        name='concat_rows',
    )
    unsqueeze = helper.make_node(
        'Unsqueeze', ['rows', 'axes'], ['output0'], name='add_batch'
    )
    axes = numpy_helper.from_array(np.array([0], dtype=np.int64), name='axes')

    # 常量节点
    n_boxes = helper.make_node('Constant', [], ['boxes_v'], value=boxes_const)
    n_scores = helper.make_node('Constant', [], ['scores_v'], value=scores_const)
    n_cls = helper.make_node('Constant', [], ['cls_v'], value=cls_const)
    n_axes = helper.make_node('Constant', [], ['axes'], value=axes)

    out = helper.make_tensor_value_info('output0', TensorProto.FLOAT, [1, max_det, 6])
    debug_out = helper.make_tensor_value_info('debug', TensorProto.FLOAT, [1, 3, 640, 640])

    graph = helper.make_graph(
        [identity, n_boxes, n_scores, n_cls, n_axes, concat, unsqueeze],
        'seer_dummy_yolo26_e2e',
        [inp],
        [out, debug_out],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(model.SerializeToString())
    print(f'[OK] dummy e2e model written: {out_path}')


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'yolo26-dummy-e2e.onnx'
    build(target)
