import * as echarts from 'echarts/core';
import { CustomChart, ScatterChart } from 'echarts/charts';
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  ScatterChart,
  CustomChart,
  GridComponent,
  DatasetComponent,
  DataZoomComponent,
  TooltipComponent,
  LegendComponent,
  PolarComponent,
  CanvasRenderer,
]);

export { echarts };
export type EChartsInstance = ReturnType<typeof echarts.init>;
